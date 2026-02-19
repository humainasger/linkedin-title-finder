# LinkedIn Title Finder - titles.asger.me

## What This Is
A branded chatbot that helps LinkedIn advertisers find the right job titles for audience targeting. Users describe their target audience in natural language, and the AI searches through 23,400+ official LinkedIn ad job titles to suggest the best matches with reasoning.

## Tech Stack
- **Frontend:** Astro + vanilla JS (lightweight chat UI)
- **Backend:** Hono on Node.js (API server)
- **AI:** Anthropic Claude API (via `@anthropic-ai/sdk`)
- **Search:** In-memory fuzzy search + AI reasoning (no vector DB needed for MVP)
- **Styling:** Tailwind CSS v4, asger.me brand tokens
- **Deploy:** Docker, single container (static + API)

## Architecture

### Single-service approach
One Hono server that:
1. Serves the static Astro-built frontend
2. Exposes `POST /api/chat` for the AI conversation

### How the title matching works
1. User describes their audience (e.g. "procurement managers in manufacturing")
2. Backend sends the description to Claude with instructions to:
   - Generate 10-20 search keywords/patterns from the description
   - Match against the full title list using keyword/fuzzy matching
   - Return top candidates (up to 200)
3. Second Claude call with the candidates: reason about each, group by relevance tier (High/Medium/Low match), explain why
4. Return structured response to frontend

### Title Database
- `job-titles.csv` contains 23,413 titles (one per line, header row "Job Title")
- Load into memory on server start as a simple string array
- For matching: lowercase comparison, substring matching, word boundary matching

## Brand / Design

### asger.me Design Tokens
- **Background:** `#FAF8F5` (warm off-white)
- **Text:** `#1a1a1a` (near-black)
- **Accent:** `#c2410c` (warm orange, used sparingly)
- **Headings font:** `new-kansas` (or fallback: Georgia, serif)
- **Body font:** `acumin-pro` (or fallback: system-ui, sans-serif)
- **Border radius:** subtle (4-8px)
- **Vibe:** Clean, professional, warm. Not corporate. Think consultant's tool.

### Chat UI
- Full-width single page, centered max-w-3xl
- Top: "LinkedIn Title Finder" heading + one-liner description
- Chat area: alternating user/assistant messages
- Input: text input at bottom with send button
- Assistant messages show:
  - Brief intro text
  - Title suggestions grouped by tier (High Match / Medium Match / Explore)
  - Each title as a tag/chip that can be clicked to copy
  - Total count of suggested titles
  - "Copy all" button that copies titles as comma-separated list
- Subtle "Built by Asger Teglgaard" footer with link to asger.me

### Mobile-first
- Works great on phone (Asger demos this to clients)
- Touch-friendly chips/buttons (min 44px)

## File Structure
```
/
├── CLAUDE.md
├── job-titles.csv
├── Dockerfile
├── package.json
├── tsconfig.json
├── astro.config.mjs
├── tailwind.config.mjs
├── src/
│   ├── pages/
│   │   └── index.astro          # Main chat page
│   ├── layouts/
│   │   └── Layout.astro         # Base HTML layout
│   ├── components/
│   │   └── Chat.astro           # Chat UI (hydrated with client JS)
│   └── styles/
│       └── global.css           # Tailwind + brand tokens
├── server/
│   ├── index.ts                 # Hono server (serves static + API)
│   ├── titles.ts                # Title loading + search logic
│   ├── chat.ts                  # Chat endpoint handler
│   └── prompts.ts               # System prompts for Claude
└── public/
    └── favicon.svg
```

## API

### POST /api/chat
```json
// Request
{
  "message": "I want to target people who make purchasing decisions at mid-size tech companies",
  "history": [
    { "role": "user", "content": "..." },
    { "role": "assistant", "content": "..." }
  ]
}

// Response
{
  "message": "Based on your description, here are the LinkedIn job titles I'd recommend...",
  "titles": {
    "high": ["Purchasing Manager", "Procurement Director", ...],
    "medium": ["Supply Chain Manager", "Vendor Manager", ...],
    "explore": ["Operations Director", "Strategic Sourcing Manager", ...]
  },
  "totalCount": 42,
  "reasoning": "I focused on titles with direct purchasing authority..."
}
```

## Environment Variables
- `ANTHROPIC_API_KEY` - Claude API key (required)
- `PORT` - Server port (default: 3000)

## Dockerfile
Multi-stage: build Astro static in stage 1, copy dist + server to production stage 2. Use Node 22 alpine. The Hono server serves the Astro dist folder as static files.

## Key Implementation Notes

1. **Title search strategy:** Don't send all 23K titles to Claude. First do local keyword matching to narrow to ~500 candidates, then let Claude reason over those. This keeps costs low and responses fast.

2. **Conversation memory:** Support multi-turn. User might say "also add finance titles" or "remove the junior ones". Keep history in frontend state, send last 10 messages to API.

3. **Copy functionality:** When user clicks a title chip, copy that single title. "Copy all" copies all high+medium titles as a comma-separated list (ready to paste into LinkedIn Campaign Manager).

4. **Loading state:** Show typing indicator while AI processes. Responses take 3-8 seconds.

5. **Error handling:** If API key missing, show friendly "Tool is being set up" message. If Claude errors, retry once then show error.

6. **No auth needed.** This is a public tool. Rate limit by IP (10 requests/min) to prevent abuse.

## Build & Run
```bash
npm install
npm run build      # Builds Astro static
npm run dev        # Dev mode (Astro dev + API server)
npm start          # Production (serves built static + API)
```

## When Done
After everything builds and runs locally:
1. Run: `openclaw gateway wake --text "Done: LinkedIn Title Finder built and ready for deployment" --mode now`
