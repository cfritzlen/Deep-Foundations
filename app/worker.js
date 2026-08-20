// Cloudflare Worker: serves the built app (static assets) and one API route,
// POST /api/scan-ticket, which reads a concrete ticket photo with Claude.
// The Anthropic API key lives in a Workers secret (ANTHROPIC_API_KEY) — it is
// never shipped to the browser.
import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'

const TicketSchema = z.object({
  truck_no: z.string().nullable(),
  ticket_no: z.string().nullable(),
  volume_cy: z.number().nullable(),
  mix_code: z.string().nullable(),
  strength_psi: z.number().nullable(),
  supplier: z.string().nullable(),
})

const PROMPT = `This is a photo of a concrete delivery ticket (batch ticket) from a
ready-mix truck at a construction site. Values may be printed OR handwritten —
read both carefully. Extract:
- truck_no: the truck number
- ticket_no: the ticket/load number
- volume_cy: the volume of THIS load, in cubic yards. Tickets label this many
  ways: "LOAD QTY", "THIS LOAD", "QTY", "LOAD", "YDS", "CY", "DEL QTY", or a
  bare number near the mix line. It is often handwritten. If both a load
  quantity and a cumulative/total-to-date quantity appear, return the load
  quantity (usually the smaller number). CHECK THE UNIT: metric tickets show
  cubic metres ("m3", "cubic metres") — convert those to cubic yards by
  multiplying by 1.308 and round to one decimal (e.g. 6.00 m3 -> 7.8).
  Only return null if no per-load quantity is anywhere on the ticket.
- mix_code: the mix design code or ID as printed
- strength_psi: the design strength in psi, if shown
- supplier: the ready-mix supplier or plant name
For fields other than volume_cy, use null when you cannot read them confidently.`

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)

    if (url.pathname === '/api/scan-ticket' && request.method === 'POST') {
      try {
        if (!env.ANTHROPIC_API_KEY) {
          return json({ error: 'Ticket scanner is not set up yet (missing API key on the server).' }, 503)
        }
        const { image, media_type } = await request.json()
        if (!image) return json({ error: 'No image received.' }, 400)

        const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })
        const response = await client.messages.parse({
          model: 'claude-opus-5',
          max_tokens: 2048,
          output_config: { effort: 'low', format: zodOutputFormat(TicketSchema) },
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'image',
                  source: { type: 'base64', media_type: media_type || 'image/jpeg', data: image },
                },
                { type: 'text', text: PROMPT },
              ],
            },
          ],
        })

        if (response.stop_reason === 'refusal' || !response.parsed_output) {
          return json({ error: 'Could not read the ticket from that photo — try a straighter, closer shot.' }, 422)
        }
        return json(response.parsed_output)
      } catch (e) {
        return json({ error: 'Scan failed: ' + (e?.message ?? 'unknown error') }, 500)
      }
    }

    return new Response('Not found', { status: 404 })
  },
}
