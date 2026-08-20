import React, { useEffect, useState } from 'react'
import { getJobObstructions, fmtTime } from '../lib/db.js'
import { COMPANY } from '../lib/config.js'
import { BigButton, Loading, ErrBox } from '../components/ui.jsx'

// Job-wide obstruction log: every obstruction on every pile, one table.
export default function ObstructionLog({ job }) {
  const [events, setEvents] = useState(null)
  const [err, setErr] = useState(null)

  useEffect(() => {
    getJobObstructions(job.id).then(setEvents).catch((e) => setErr(e.message))
  }, [job.id])

  if (err) return <div className="screen"><ErrBox>{err}</ErrBox></div>
  if (!events) return <div className="screen"><Loading /></div>

  // pair hit -> cleared per pile
  const open = {}
  const rows = []
  for (const e of events) {
    if (e.event_type === 'obstruction_hit') {
      const row = {
        id: e.id, pile: e.pile.label, ts: e.ts,
        depth: e.data?.depth_ft, type: e.data?.type ?? 'unknown',
        note: e.data?.note, cleared: null,
      }
      open[e.pile.id] = row
      rows.push(row)
    } else if (open[e.pile.id]) {
      open[e.pile.id].cleared = e.ts
      delete open[e.pile.id]
    }
  }
  const lostMin = (r) => (r.cleared ? Math.round((new Date(r.cleared) - new Date(r.ts)) / 60000) : null)
  const totalLost = rows.reduce((s, r) => s + (lostMin(r) ?? 0), 0)

  return (
    <div className="screen">
      <div className="exportbar">
        <BigButton color="gold" onClick={() => window.print()}>Print / save PDF</BigButton>
      </div>

      <div className="sheet">
        <div className="sheet-head">
          <img src="/bedrock-logo.png" alt="" />
          <div className="co">
            <b>{COMPANY.name}</b>
            <span>{COMPANY.tagline} · {COMPANY.address} · {COMPANY.phone}</span>
          </div>
          <div className="doctitle">
            <b>Obstruction Log</b>
            <span>{job.job_number} · {job.name}</span>
          </div>
        </div>

        <h4>
          All Obstructions — {rows.length} total
          {totalLost > 0 && `, ${Math.floor(totalLost / 60)} hr ${totalLost % 60} min lost`}
        </h4>
        {rows.length === 0 ? (
          <p style={{ padding: '10px 0' }}>No obstructions logged on this job yet.</p>
        ) : (
          <table className="grid"><thead>
            <tr><th>Date</th><th>Pile</th><th>Depth</th><th>Type</th><th>Hit</th><th>Cleared</th><th>Lost time</th></tr>
          </thead><tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{new Date(r.ts).toLocaleDateString([], { month: 'numeric', day: 'numeric', year: '2-digit' })}</td>
                <td><b>{r.pile}</b></td>
                <td>{r.depth ?? '—'} ft</td>
                <td style={{ textAlign: 'left' }}>{r.type}{r.note ? ` — ${r.note}` : ''}</td>
                <td>{fmtTime(r.ts)}</td>
                <td>{r.cleared ? fmtTime(r.cleared) : 'not cleared'}</td>
                <td>{lostMin(r) != null ? lostMin(r) + ' min' : '—'}</td>
              </tr>
            ))}
          </tbody></table>
        )}

        <div className="sig">
          <div>Field Engineer / Date</div>
          <div>Superintendent / Date</div>
        </div>
      </div>
    </div>
  )
}
