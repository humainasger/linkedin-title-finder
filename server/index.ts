import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { chatHandler } from './chat.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

// Load titles
const csv = readFileSync(join(root, 'job-titles.csv'), 'utf-8')
const titles = csv.split('\n').slice(1).map(l => l.trim()).filter(Boolean)
console.log(`Loaded ${titles.length} job titles`)

const app = new Hono()
app.use('*', cors())

// API
app.post('/api/chat', async (c) => {
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

// Static files
app.use('/*', serveStatic({ root: join(root, 'public') }))
app.get('/', serveStatic({ path: join(root, 'public', 'index.html') }))

const port = parseInt(process.env.PORT || '3000')
console.log(`Starting on port ${port}`)
serve({ fetch: app.fetch, port })
