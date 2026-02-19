import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic()

function searchTitles(query: string, allTitles: string[]): string[] {
  const terms = query.toLowerCase().split(/[\s,]+/).filter(t => t.length > 2)
  const scored = new Map<string, number>()

  for (const title of allTitles) {
    const lower = title.toLowerCase()
    let score = 0
    for (const term of terms) {
      if (lower === term) score += 10
      else if (lower.includes(term)) score += 3
      else {
        // Fuzzy: check if any word in the title starts with the term
        const words = lower.split(/\s+/)
        for (const w of words) {
          if (w.startsWith(term) || term.startsWith(w)) score += 1
        }
      }
    }
    if (score > 0) scored.set(title, score)
  }

  return [...scored.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 500)
    .map(([t]) => t)
}

const SYSTEM_PROMPT = `You are an expert LinkedIn Ads audience targeting consultant. You help advertisers find the exact job titles available in LinkedIn's Campaign Manager for their target audience.

You have access to the full list of ~23,000 official LinkedIn ad-targetable job titles.

When the user describes their target audience:
1. Think about what roles, seniority levels, and functions match their description
2. Search for relevant titles across different phrasings and seniority levels
3. Group your suggestions by match quality

IMPORTANT RULES:
- ONLY suggest titles from the provided candidate list - never make up titles
- Think broadly: if someone says "decision makers in IT", include CTOs, CIOs, IT Directors, VP of Engineering, etc.
- Consider adjacent roles that might also be relevant
- Be practical: explain WHY certain titles are included

Respond in this exact JSON format:
{
  "intro": "Brief 1-2 sentence summary of your approach",
  "high": ["Title 1", "Title 2"],
  "medium": ["Title 3", "Title 4"],
  "explore": ["Title 5", "Title 6"],
  "reasoning": "Brief explanation of your grouping logic",
  "tip": "One practical tip for their LinkedIn campaign targeting"
}

- "high": Titles that directly match the described audience (core targets)
- "medium": Titles that are adjacent or secondary matches (good to include)
- "explore": Titles worth testing that might surprise them

Keep each tier to 5-25 titles max. Quality over quantity.`

export async function chatHandler(
  message: string,
  history: { role: string; content: string }[],
  allTitles: string[]
) {
  // Step 1: Ask Claude to generate search terms
  const searchResponse = await client.messages.create({
    model: 'claude-3-5-haiku-20241022',
    max_tokens: 300,
    system: 'Extract search keywords from this audience description. Return ONLY a comma-separated list of keywords/phrases to search for in a job title database. Include variations, synonyms, related terms, seniority levels. No explanation, just the keywords.',
    messages: [{ role: 'user', content: message }]
  })

  const searchTerms = (searchResponse.content[0] as any).text || message
  
  // Step 2: Local search
  const candidates = searchTitles(searchTerms + ' ' + message, allTitles)
  
  if (candidates.length === 0) {
    return {
      message: "I couldn't find any matching titles. Try describing your audience differently - for example, mention the job function, seniority level, or industry.",
      titles: { high: [], medium: [], explore: [] },
      totalCount: 0,
      reasoning: "No matches found for the given description."
    }
  }

  // Step 3: Claude reasons over candidates
  const msgs: Anthropic.MessageParam[] = [
    ...history.slice(-8).map(h => ({
      role: h.role as 'user' | 'assistant',
      content: h.content
    })),
    {
      role: 'user',
      content: `Target audience description: "${message}"

Here are ${candidates.length} candidate job titles from LinkedIn's database. Select and group the most relevant ones:

${candidates.join('\n')}`
    }
  ]

  const response = await client.messages.create({
    model: 'claude-3-5-haiku-20241022',
    max_tokens: 2000,
    system: SYSTEM_PROMPT,
    messages: msgs
  })

  const text = (response.content[0] as any).text || '{}'
  
  // Parse JSON from response (handle markdown code blocks)
  let parsed
  try {
    const jsonStr = text.replace(/```json?\n?/g, '').replace(/```/g, '').trim()
    parsed = JSON.parse(jsonStr)
  } catch {
    // Fallback: return raw text
    return {
      message: text,
      titles: { high: candidates.slice(0, 15), medium: candidates.slice(15, 30), explore: [] },
      totalCount: Math.min(candidates.length, 30),
      reasoning: "Could not parse structured response."
    }
  }

  const high = parsed.high || []
  const medium = parsed.medium || []
  const explore = parsed.explore || []

  return {
    message: parsed.intro || "Here are my suggestions:",
    titles: { high, medium, explore },
    totalCount: high.length + medium.length + explore.length,
    reasoning: parsed.reasoning || "",
    tip: parsed.tip || ""
  }
}
