import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { readFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { chatHandler } from './chat.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

// Load titles
const csv = readFileSync(join(root, 'job-titles.csv'), 'utf-8')
const titles = csv.split('\n').slice(1).map(l => l.trim()).filter(Boolean)
console.log(`Loaded ${titles.length} job titles`)

// Simple rate limiter
const rateMap = new Map<string, number[]>()
function rateLimit(ip: string): boolean {
  const now = Date.now()
  const window = 60_000
  const max = 10
  const hits = (rateMap.get(ip) || []).filter(t => now - t < window)
  if (hits.length >= max) return false
  hits.push(now)
  rateMap.set(ip, hits)
  return true
}

const app = new Hono()
app.use('*', cors())

// Health check
app.get('/health', (c) => c.text('ok'))

// API
app.post('/api/chat', async (c) => {
  const ip = c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'unknown'
  if (!rateLimit(ip)) {
    return c.json({ error: 'Too many requests. Please wait a minute.' }, 429)
  }

  const body = await c.req.json<{ message: string; history?: { role: string; content: string }[] }>()
  if (!body.message) return c.json({ error: 'message required' }, 400)
  
  try {
    const result = await chatHandler(body.message, body.history || [], titles)
    return c.json(result)
  } catch (e: any) {
    console.error('Chat error:', e.message)
    return c.json({ error: 'Something went wrong. Try again.' }, 500)
  }
})

// Serve static files manually (avoids serveStatic import issues)
const publicDir = join(root, 'public')
const mimeTypes: Record<string, string> = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
}

app.get('/*', (c) => {
  let path = c.req.path
  if (path === '/') path = '/index.html'
  
  const filePath = join(publicDir, path)
  
  // Security: prevent directory traversal
  if (!filePath.startsWith(publicDir)) {
    return c.text('Forbidden', 403)
  }
  
  if (!existsSync(filePath)) {
    // SPA fallback
    const indexPath = join(publicDir, 'index.html')
    if (existsSync(indexPath)) {
      const content = readFileSync(indexPath, 'utf-8')
      return c.html(content)
    }
    return c.text('Not found', 404)
  }
  
  const ext = '.' + filePath.split('.').pop()
  const mime = mimeTypes[ext] || 'application/octet-stream'
  const content = readFileSync(filePath)
  
  return new Response(content, {
    headers: { 'Content-Type': mime, 'Cache-Control': 'public, max-age=3600' }
  })
})

const port = parseInt(process.env.PORT || '3000')
console.log(`Starting on port ${port}`)
serve({ fetch: app.fetch, port })
