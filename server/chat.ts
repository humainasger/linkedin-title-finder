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

const INTERVIEW_SYSTEM = `You are an expert LinkedIn Ads audience targeting consultant. Your job is to help advertisers build precise audiences using LinkedIn's job title targeting.

When a user gives you an initial audience description, you need to interview them to get the full picture before recommending titles. You ask SHORT, conversational questions - one at a time.

Here's what you need to know (in order of importance):
1. What company or product are the ads for? (helps you understand what they're selling)
2. What's the seniority level they want? (decision makers, practitioners, or both)
3. Any specific industries or verticals to focus on?
4. What company size are they targeting? (startup, SMB, mid-market, enterprise)
5. Anything to EXCLUDE? (titles or roles that would waste budget)

RULES:
- Ask ONE question at a time
- Keep questions short and casual (1-2 sentences max)
- If the user already answered something in their initial prompt, skip that question
- After you have enough context (3-5 questions answered), say you're ready to generate titles
- Always respond in JSON format

Response format:
{
  "type": "question",
  "message": "Your question here",
  "questionNumber": 1,
  "totalQuestions": 5,
  "context": { "company": null, "seniority": null, "industry": null, "companySize": null, "exclusions": null }
}

When you have enough info and want to signal you're ready:
{
  "type": "ready",
  "message": "Great, I have a clear picture. Let me find the best titles for you.",
  "context": { "company": "...", "seniority": "...", "industry": "...", "companySize": "...", "exclusions": "..." },
  "searchDescription": "A comprehensive description combining all the context for title search"
}`

const TITLES_SYSTEM = `You are an expert LinkedIn Ads audience targeting consultant. You help advertisers find the exact job titles available in LinkedIn's Campaign Manager for their target audience.

You have access to the full list of ~23,000 official LinkedIn ad-targetable job titles.

Given the full context about the advertiser and their target audience:
1. Think about what roles, seniority levels, and functions match
2. Search for relevant titles across different phrasings and seniority levels
3. Group your suggestions by match quality
4. Consider the company/product context to pick titles of people who would BUY that product

IMPORTANT RULES:
- ONLY suggest titles from the provided candidate list - never make up titles
- Think broadly about adjacent roles
- Be practical: explain WHY certain titles are included
- Reference the company/product when explaining your reasoning

Respond in this exact JSON format:
{
  "intro": "Brief 1-2 sentence summary referencing their company/product",
  "audienceName": "LI | CompanyName | AudienceSegment | Seniority | CompanySize",
  "high": ["Title 1", "Title 2"],
  "medium": ["Title 3", "Title 4"],
  "explore": ["Title 5", "Title 6"],
  "reasoning": "Brief explanation of your grouping logic, referencing their specific context",
  "tip": "One practical tip for their specific LinkedIn campaign"
}

The "audienceName" follows LinkedIn campaign naming convention: Platform | Company | Segment | Seniority | Size/Industry. This should be specific enough to identify the audience at a glance in Campaign Manager. Examples:
- "LI | HubSpot | MarketingOps | VP+ | MidMarket"
- "LI | Deel | PeopleLeaders | Director+ | 200-5000"
- "LI | Figma | DesignLeaders | Head+ | Tech"

- "high": Core targets - directly match the described audience (5-20 titles)
- "medium": Adjacent matches - good to include for broader reach (5-15 titles)
- "explore": Worth testing - might surprise them (3-10 titles)

Quality over quantity.`

export async function chatHandler(
  message: string,
  history: { role: string; content: string }[],
  allTitles: string[]
) {
  // Determine if we're in interview mode or title generation mode
  // Check if the last assistant message was a "ready" signal
  const lastAssistantMsg = [...history].reverse().find(h => h.role === 'assistant')
  let isReadyToGenerate = false
  let fullContext = ''

  if (lastAssistantMsg) {
    try {
      const parsed = JSON.parse(lastAssistantMsg.content)
      if (parsed.type === 'ready') {
        isReadyToGenerate = true
        fullContext = parsed.searchDescription || ''
      }
    } catch {
      // Not JSON - check if it contains title results (already generated)
      // Continue with interview
    }
  }

  // Check if this is a follow-up after titles were already shown
  // (user says "also add finance titles" or "remove the junior ones")
  const hasResults = history.some(h => {
    try {
      const p = JSON.parse(h.content)
      return p.type === 'titles'
    } catch { return false }
  })

  if (hasResults) {
    // Refinement mode - generate new titles based on the full conversation
    return await generateTitles(message, history, allTitles, '')
  }

  if (isReadyToGenerate) {
    // User just confirmed, now generate titles
    return await generateTitles(message, history, allTitles, fullContext)
  }

  // Interview mode
  return await interviewStep(message, history)
}

async function interviewStep(
  message: string,
  history: { role: string; content: string }[]
) {
  const msgs: Anthropic.MessageParam[] = [
    ...history.slice(-10).map(h => ({
      role: h.role as 'user' | 'assistant',
      content: h.content
    })),
    { role: 'user', content: message }
  ]

  const response = await client.messages.create({
    model: 'claude-3-5-haiku-20241022',
    max_tokens: 500,
    system: INTERVIEW_SYSTEM,
    messages: msgs
  })

  const text = (response.content[0] as any).text || '{}'

  let parsed
  try {
    // Try to extract JSON from various model outputs
    let jsonStr = text.replace(/```json?\n?/g, '').replace(/```/g, '').trim()
    // If the model wrapped JSON in text, find the JSON object
    const jsonMatch = jsonStr.match(/\{[\s\S]*\}/)
    if (jsonMatch) jsonStr = jsonMatch[0]
    parsed = JSON.parse(jsonStr)
  } catch {
    return {
      type: 'question' as const,
      message: text,
      questionNumber: 0,
      totalQuestions: 5
    }
  }

  // Normalize the response - strip extra fields the model adds
  if (parsed.type === 'question') {
    return {
      type: 'question' as const,
      message: parsed.message || '',
      questionNumber: parsed.questionNumber || 0,
      totalQuestions: parsed.totalQuestions || 5,
      context: parsed.context || {}
    }
  }

  if (parsed.type === 'ready') {
    return {
      type: 'ready' as const,
      message: parsed.message || 'Let me find the best titles for you.',
      context: parsed.context || {},
      searchDescription: parsed.searchDescription || ''
    }
  }

  return parsed
}

async function generateTitles(
  message: string,
  history: { role: string; content: string }[],
  allTitles: string[],
  contextOverride: string
) {
  // Build full context from conversation history
  const conversationContext = contextOverride || history
    .filter(h => h.role === 'user')
    .map(h => h.content)
    .join(' ') + ' ' + message

  // Step 1: Generate search terms
  const searchResponse = await client.messages.create({
    model: 'claude-3-5-haiku-20241022',
    max_tokens: 400,
    system: 'Extract search keywords from this audience targeting context. Return ONLY a comma-separated list of keywords/phrases to search for in a job title database. Include variations, synonyms, related terms, seniority levels. Think about what job titles would be relevant for someone buying this product/service. No explanation, just the keywords.',
    messages: [{ role: 'user', content: conversationContext }]
  })

  const searchTerms = (searchResponse.content[0] as any).text || message

  // Step 2: Local search
  const candidates = searchTitles(searchTerms + ' ' + conversationContext, allTitles)

  if (candidates.length === 0) {
    return {
      type: 'titles' as const,
      message: "I couldn't find matching titles. Could you describe the roles differently?",
      titles: { high: [], medium: [], explore: [] },
      totalCount: 0,
      reasoning: "No matches found."
    }
  }

  // Step 3: Build the full context for the title selection
  const contextSummary = history
    .map(h => `${h.role}: ${h.content}`)
    .join('\n')

  const msgs: Anthropic.MessageParam[] = [
    {
      role: 'user',
      content: `Full conversation context:
${contextSummary}
User's latest message: ${message}

Here are ${candidates.length} candidate job titles from LinkedIn's database. Select and group the most relevant ones based on ALL the context above:

${candidates.join('\n')}`
    }
  ]

  const response = await client.messages.create({
    model: 'claude-3-5-haiku-20241022',
    max_tokens: 2000,
    system: TITLES_SYSTEM,
    messages: msgs
  })

  const text = (response.content[0] as any).text || '{}'

  let parsed
  try {
    const jsonStr = text.replace(/```json?\n?/g, '').replace(/```/g, '').trim()
    parsed = JSON.parse(jsonStr)
  } catch {
    return {
      type: 'titles' as const,
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
    type: 'titles' as const,
    message: parsed.intro || "Here are my suggestions:",
    audienceName: parsed.audienceName || "",
    titles: { high, medium, explore },
    totalCount: high.length + medium.length + explore.length,
    reasoning: parsed.reasoning || "",
    tip: parsed.tip || ""
  }
}
