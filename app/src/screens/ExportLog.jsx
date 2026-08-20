import React, { useEffect, useState } from 'react'
import { getPileBundle, ticketPhotoUrl, fmtTime, fmtDate } from '../lib/db.js'
import { COMPANY } from '../lib/config.js'
import { BigButton, Loading, ErrBox } from '../components/ui.jsx'
import { describeEvent } from './ShaftLog.jsx'

const EVENT_LABEL = {
  drill_start: 'Started drilling', drill_end: 'Stopped drilling',
  obstruction_hit: 'OBSTRUCTION', obstruction_cleared: 'Obstruction cleared',
  inspection: 'Inspection', socket_extension: 'Socket extended',
  cage_set: 'Cage set', pour_start: 'Pour started', pour_end: 'Pour ended',
  drive_start: 'Started driving', drive_end: 'End of drive',
  pile_run: 'Pile ran', pile_failed: 'PILE FAILED', note: 'Note',
}

export default function ExportLog({ pile, job }) {
  const [bundle, setBundle] = useState(null)
  const [err, setErr] = useState(null)

  useEffect(() => {
    getPileBundle(pile.id).then(setBundle).catch((e) => setErr(e.message))
  }, [pile.id])

  if (err) return <div className="screen"><ErrBox>{err}</ErrBox></div>
  if (!bundle) return <div className="screen"><Loading /></div>

  const { pile: p, days, events, blows, tickets } = bundle
  const isShaft = p.pile_kind === 'shaft'
  const socketExt = Number(p.socket_extension_ft ?? 0)
  const totalBlows = blows.reduce((s, b) => s + b.blows, 0)
  const totalCy = tickets.reduce((s, t) => s + Number(t.volume_cy || 0), 0)
  const obstPairs = pairObstructions(events)
  const dayEquip = days.map((d) => d.equipment).filter(Boolean)
  const hammer = dayEquip.find((e) => e.hammer_make_model)

  return (
    <div className="screen">
      <div className="exportbar">
        <BigButton color="gold" onClick={() => window.print()}>
          Print / save PDF
        </BigButton>
      </div>

      <div className="sheet">
        {/* header */}
        <div className="sheet-head">
          <img src="/bedrock-logo.png" alt="" />
          <div className="co">
            <b>{COMPANY.name}</b>
            <span>{COMPANY.tagline} · {COMPANY.address} · {COMPANY.phone}</span>
          </div>
          <div className="doctitle">
            <b>{isShaft ? 'Drilled Shaft Log' : 'Pile Driving Log'}</b>
            <span>{job.job_number} · {isShaft ? 'Shaft' : 'Pile'} {p.label}</span>
          </div>
        </div>

        {/* summary */}
        <h4>Project & {isShaft ? 'Shaft' : 'Pile'} Data</h4>
        <table className="info"><tbody>
          <tr><td className="l">Project</td><td>{job.name}, {job.location}</td>
              <td className="l">{isShaft ? 'Shaft' : 'Pile'}</td><td><b>{p.label}</b> — {p.description}</td></tr>
          <tr>
            <td className="l">Dates</td>
            <td>{days.map((d) => fmtDate(d.work_date)).join(' · ') || '—'}</td>
            {isShaft ? (
              <>
                <td className="l">Casing / Socket</td>
                <td>
                  Casing req. {p.required_casing_depth_ft} ft · Socket req. {p.required_socket_depth_ft} ft
                  {socketExt > 0 && (
                    <span className="revised"> — revised to {Number(p.required_socket_depth_ft) + socketExt} ft (+{socketExt} ft per inspection)</span>
                  )}
                </td>
              </>
            ) : (
              <>
                <td className="l">Criteria</td>
                <td>{p.driving_criteria} · req. tip elev. {p.required_tip_elev_ft} ft</td>
              </>
            )}
          </tr>
          {!isShaft && hammer && (
            <tr><td className="l">Rig / Hammer</td>
                <td colSpan="3">{dayEquip[0]?.name} — {hammer.hammer_make_model} ({hammer.hammer_type}), rated {Number(hammer.rated_energy_ftlbs).toLocaleString()} ft-lbs</td></tr>
          )}
          {isShaft && p.mix && (
            <tr><td className="l">Mix design</td>
                <td colSpan="3">{p.mix.code} — {p.mix.strength_psi} psi, {p.mix.description} ({p.mix.supplier})</td></tr>
          )}
          <tr><td className="l">Status</td><td colSpan="3" style={{ textTransform: 'capitalize' }}>
            <b>{p.status.replace('_', ' ')}</b>
            {p.status === 'rejected' && ' — see replacement pile ' + p.label + 'R'}
          </td></tr>
        </tbody></table>

        {/* work days */}
        <h4>Work Days</h4>
        <table className="grid"><thead>
          <tr><th>Date</th><th>Start</th><th>End</th><th>Rig</th><th>Engineer</th></tr>
        </thead><tbody>
          {days.map((d) => (
            <tr key={d.id}>
              <td>{fmtDate(d.work_date)}</td>
              <td>{d.day_start ? fmtTime(d.day_start) : '—'}</td>
              <td>{d.day_end ? fmtTime(d.day_end) : '—'}</td>
              <td>{d.equipment?.name ?? '—'}</td>
              <td>{d.engineer ?? '—'}</td>
            </tr>
          ))}
        </tbody></table>

        {/* activity */}
        <h4>Activity Log</h4>
        <table className="grid"><thead>
          <tr><th style={{ width: 90 }}>Date</th><th style={{ width: 70 }}>Time</th><th>Entry</th></tr>
        </thead><tbody>
          {events.map((e) => (
            <tr key={e.id}>
              <td>{new Date(e.ts).toLocaleDateString([], { month: 'numeric', day: 'numeric', year: '2-digit' })}</td>
              <td>{fmtTime(e.ts)}</td>
              <td style={{ textAlign: 'left' }}>
                <b>{EVENT_LABEL[e.event_type] ?? e.event_type}</b> {describeEvent(e)}
              </td>
            </tr>
          ))}
        </tbody></table>

        {/* obstruction summary */}
        {obstPairs.length > 0 && (
          <>
            <h4>Obstruction Summary</h4>
            <table className="grid"><thead>
              <tr><th>Depth</th><th>Type</th><th>Hit</th><th>Cleared</th><th>Lost time</th></tr>
            </thead><tbody>
              {obstPairs.map((o, i) => (
                <tr key={i}>
                  <td>{o.depth ?? '—'} ft</td>
                  <td>{o.type}</td>
                  <td>{fmtTime(o.hit)}</td>
                  <td>{o.cleared ? fmtTime(o.cleared) : 'not cleared'}</td>
                  <td>{o.cleared ? Math.round((new Date(o.cleared) - new Date(o.hit)) / 60000) + ' min' : '—'}</td>
                </tr>
              ))}
            </tbody></table>
          </>
        )}

        {/* driving record */}
        {!isShaft && blows.length > 0 && (
          <>
            <h4>Driving Record — {totalBlows} total blows to {blows[blows.length - 1].depth_ft} ft</h4>
            <div style={{ display: 'flex', gap: 10 }}>
              {chunk(blows, Math.ceil(blows.length / Math.min(3, Math.ceil(blows.length / 22)))).map((col, i) => (
                <table className="grid" key={i} style={{ flex: 1, alignSelf: 'flex-start' }}>
                  <thead><tr><th>Ft</th><th>Blows</th><th>Stroke</th></tr></thead>
                  <tbody>
                    {col.map((b) => (
                      <tr key={b.id}>
                        <td>{b.depth_ft}</td>
                        <td>{b.blows === 0 ? 'ran' : b.blows}</td>
                        <td>{b.stroke_ft ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ))}
            </div>
          </>
        )}

        {/* concrete */}
        {isShaft && tickets.length > 0 && (
          <>
            <h4>Concrete Placement — {totalCy} CY total</h4>
            <table className="grid"><thead>
              <tr><th>Time</th><th>Truck</th><th>Ticket</th><th>CY</th><th>Slump</th><th>Air</th><th>Temp</th><th>Cyl</th><th>Ticket photo</th></tr>
            </thead><tbody>
              {tickets.map((t) => (
                <tr key={t.id}>
                  <td>{fmtTime(t.ts)}</td>
                  <td>{t.truck_no ?? '—'}</td>
                  <td>{t.ticket_no ?? '—'}</td>
                  <td>{t.volume_cy ?? '—'}</td>
                  <td>{t.slump_in != null ? t.slump_in + '"' : '—'}</td>
                  <td>{t.air_pct != null ? t.air_pct + '%' : '—'}</td>
                  <td>{t.temp_f != null ? t.temp_f + '°F' : '—'}</td>
                  <td>{t.cylinders ?? '—'}</td>
                  <td>{t.photo_path ? <img className="thumb" src={ticketPhotoUrl(t.photo_path)} alt="" /> : '—'}</td>
                </tr>
              ))}
            </tbody></table>
          </>
        )}

        {/* signatures */}
        <div className="sig">
          <div>Field Engineer / Date</div>
          <div>Superintendent / Date</div>
          <div>Inspector / Date</div>
        </div>
      </div>
    </div>
  )
}

function pairObstructions(events) {
  const out = []
  let open = null
  for (const e of events) {
    if (e.event_type === 'obstruction_hit') {
      open = { depth: e.data?.depth_ft, type: e.data?.type ?? 'unknown', hit: e.ts, cleared: null }
      out.push(open)
    }
    if (e.event_type === 'obstruction_cleared' && open) {
      open.cleared = e.ts
      open = null
    }
  }
  return out
}

function chunk(arr, size) {
  if (!size || size < 1) return [arr]
  const out = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}
