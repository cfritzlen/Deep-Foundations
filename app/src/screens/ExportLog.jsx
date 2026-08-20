import React, { useEffect, useState } from 'react'
import { getPileBundle, addEvent, ticketPhotoUrl, currentDepth, fmtTime, fmtDate } from '../lib/db.js'
import { COMPANY } from '../lib/config.js'
import { BigButton, Modal, Chips, SignaturePad, Loading, ErrBox } from '../components/ui.jsx'
import { describeEvent } from './ShaftLog.jsx'

const EVENT_LABEL = {
  drill_start: 'Started drilling', drill_end: 'Stopped drilling',
  obstruction_hit: 'OBSTRUCTION', obstruction_cleared: 'Obstruction cleared',
  inspection: 'Inspection', socket_extension: 'Socket extended',
  cage_set: 'Cage set', pour_start: 'Pour started', pour_end: 'Pour ended',
  drive_start: 'Started driving', drive_end: 'End of drive',
  pile_run: 'Pile ran', pile_failed: 'PILE FAILED', mix_warning: 'MIX WARNING',
  rock_reached: 'Top of rock', signature: 'Log signed', note: 'Note',
}

const SIGN_ROLES = ['Field Engineer', 'Superintendent', 'Inspector']

export default function ExportLog({ pile, job }) {
  const [bundle, setBundle] = useState(null)
  const [err, setErr] = useState(null)
  const [blank, setBlank] = useState(false)
  const [signing, setSigning] = useState(false)

  const reload = () => getPileBundle(pile.id).then(setBundle).catch((e) => setErr(e.message))
  useEffect(() => { reload() }, [pile.id])

  if (err) return <div className="screen"><ErrBox>{err}</ErrBox></div>
  if (!bundle) return <div className="screen"><Loading /></div>

  const { pile: p, days, events, blows, tickets } = bundle
  const isShaft = p.pile_kind === 'shaft'
  const socketExt = Number(p.socket_extension_ft ?? 0)
  const totalBlows = blows.reduce((s, b) => s + b.blows, 0)
  const totalCy = tickets.reduce((s, t) => s + Number(t.volume_cy || 0), 0)
  const obstPairs = pairObstructions(events)
  const activity = events.filter((e) => e.event_type !== 'signature')
  const dayEquip = days.map((d) => d.equipment).filter(Boolean)
  const hammer = dayEquip.find((e) => e.hammer_make_model)
  // latest signature per role
  const sigs = {}
  for (const e of events) if (e.event_type === 'signature') sigs[e.data.role] = e
  // sketch geometry
  const finalDepth = isShaft ? currentDepth(events) : (blows.length ? blows[blows.length - 1].depth_ft : 0)
  const rockEvent = [...events].reverse().find((e) => e.event_type === 'rock_reached')
  const socketTotal = Number(p.required_socket_depth_ft ?? 0) + socketExt
  const topOfRock = rockEvent
    ? Number(rockEvent.data.depth_ft)
    : finalDepth > socketTotal ? finalDepth - socketTotal : Number(p.required_casing_depth_ft ?? 0)
  const driveEnd = [...events].reverse().find((e) => e.event_type === 'drive_end')
  const tipElev = driveEnd?.data?.tip_elev_ft ?? null

  return (
    <div className="screen">
      <div className="exportbar">
        <BigButton color="gold" onClick={() => window.print()}>
          Print / save PDF
        </BigButton>
        <BigButton color="ghost" onClick={() => setBlank(!blank)}>
          {blank ? 'Show filled log' : 'Blank paper form'}
        </BigButton>
        {!blank && (
          <BigButton onClick={() => setSigning(true)}>✍ Sign</BigButton>
        )}
      </div>

      <div className={`sheet ${blank ? 'blankform' : ''}`}>
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

        {/* summary — stays pre-filled even on the blank form */}
        <h4>Project & {isShaft ? 'Shaft' : 'Pile'} Data</h4>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <table className="info" style={{ flex: '1 1 300px', width: 'auto' }}><tbody>
          <tr><td className="l">Project</td><td>{job.name}, {job.location}</td>
              <td className="l">{isShaft ? 'Shaft' : 'Pile'}</td><td><b>{p.label}</b> — {p.description}</td></tr>
          <tr>
            <td className="l">Dates</td>
            <td>{blank ? '' : days.map((d) => fmtDate(d.work_date)).join(' · ') || '—'}</td>
            {isShaft ? (
              <>
                <td className="l">Casing / Socket</td>
                <td>
                  Casing req. {p.required_casing_depth_ft} ft · Socket req. {p.required_socket_depth_ft} ft
                  {!blank && socketExt > 0 && (
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
          {!blank && !isShaft && hammer && (
            <tr><td className="l">Rig / Hammer</td>
                <td colSpan="3">{dayEquip[0]?.name} — {hammer.hammer_make_model} ({hammer.hammer_type}), rated {Number(hammer.rated_energy_ftlbs).toLocaleString()} ft-lbs</td></tr>
          )}
          {blank && !isShaft && (
            <tr><td className="l">Rig / Hammer</td><td colSpan="3">&nbsp;</td></tr>
          )}
          {isShaft && p.mix && (
            <tr><td className="l">Mix design</td>
                <td colSpan="3">{p.mix.code} — {p.mix.strength_psi} psi, {p.mix.description} ({p.mix.supplier})</td></tr>
          )}
          {!blank && (
            <tr><td className="l">Status</td><td colSpan="3" style={{ textTransform: 'capitalize' }}>
              <b>{p.status.replace('_', ' ')}</b>
              {p.status === 'rejected' && ' — see replacement pile ' + p.label + 'R'}
            </td></tr>
          )}
        </tbody></table>
        <PileSketch p={p} isShaft={isShaft} blank={blank} finalDepth={finalDepth}
          topOfRock={topOfRock} socketTotal={socketTotal} tipElev={tipElev} />
        </div>

        {/* work days */}
        <h4>Work Days</h4>
        <table className="grid"><thead>
          <tr><th>Date</th><th>Start</th><th>End</th><th>Rig</th><th>Engineer</th></tr>
        </thead><tbody>
          {blank
            ? emptyRows(3, 5)
            : days.map((d) => (
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
          {blank
            ? emptyRows(14, 3)
            : activity.map((e) => (
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
        {(blank || obstPairs.length > 0) && (
          <>
            <h4>Obstruction Summary</h4>
            <table className="grid"><thead>
              <tr><th>Depth</th><th>Type</th><th>Hit</th><th>Cleared</th><th>Lost time</th></tr>
            </thead><tbody>
              {blank
                ? emptyRows(3, 5)
                : obstPairs.map((o, i) => (
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
        {!isShaft && (blank || blows.length > 0) && (
          <>
            <h4>
              Driving Record
              {!blank && ` — ${totalBlows} total blows to ${blows[blows.length - 1].depth_ft} ft`}
            </h4>
            <div style={{ display: 'flex', gap: 10 }}>
              {blankOrRealBlowColumns(blank, blows, p).map((col, i) => (
                <table className="grid" key={i} style={{ flex: 1, alignSelf: 'flex-start' }}>
                  <thead><tr><th>Ft</th><th>Blows</th><th>Stroke</th></tr></thead>
                  <tbody>
                    {col.map((b) => (
                      <tr key={b.depth_ft}>
                        <td>{b.depth_ft}</td>
                        <td>{b.blank ? ' ' : b.blows === 0 ? 'ran' : b.blows}</td>
                        <td>{b.blank ? ' ' : b.stroke_ft ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ))}
            </div>
          </>
        )}

        {/* concrete */}
        {isShaft && (blank || tickets.length > 0) && (
          <>
            <h4>Concrete Placement{!blank && ` — ${totalCy} CY total`}</h4>
            <table className="grid"><thead>
              <tr><th>Time</th><th>Truck</th><th>Ticket</th><th>CY</th><th>Cum CY</th><th>Slump</th><th>Air</th><th>Temp</th><th>Cyl</th><th>{blank ? 'Notes' : 'Ticket photo'}</th></tr>
            </thead><tbody>
              {blank
                ? emptyRows(8, 10)
                : tickets.map((t, i) => (
                    <tr key={t.id}>
                      <td>{fmtTime(t.ts)}</td>
                      <td>{t.truck_no ?? '—'}</td>
                      <td>{t.ticket_no ?? '—'}</td>
                      <td>{t.volume_cy ?? '—'}</td>
                      <td>{tickets.slice(0, i + 1).reduce((s, x) => s + Number(x.volume_cy || 0), 0)}</td>
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
          {SIGN_ROLES.map((role) => {
            const s = blank ? null : sigs[role]
            return (
              <div key={role} className={s ? 'signed' : ''}>
                {s && <img src={s.data.image} alt="" />}
                {role} / Date
                {s && (
                  <div style={{ marginTop: 2 }}>
                    <b>{s.data.name}</b> · {fmtDate(new Date(s.ts).toISOString().slice(0, 10))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {signing && (
        <SignModal
          taken={Object.keys(sigs)}
          onClose={() => setSigning(false)}
          onSave={async (role, name, image) => {
            await addEvent(p.id, 'signature', { role, name, image })
            await reload()
            setSigning(false)
          }}
        />
      )}
    </div>
  )
}

function SignModal({ taken, onClose, onSave }) {
  const [role, setRole] = useState(null)
  const [name, setName] = useState('')
  const [image, setImage] = useState(null)
  return (
    <Modal title="Sign the log" sub="Pick your role, sign with your finger." onClose={onClose}>
      <Chips options={SIGN_ROLES} value={role} onChange={setRole} />
      {role && taken.includes(role) && (
        <div className="muted" style={{ marginBottom: 8 }}>
          {role} has already signed — saving again replaces that signature.
        </div>
      )}
      <input className="field" placeholder="Print name" value={name} onChange={(e) => setName(e.target.value)} />
      <SignaturePad onChange={setImage} />
      <BigButton color="gold" disabled={!role || !name.trim() || !image}
        onClick={() => onSave(role, name.trim(), image)} style={{ marginTop: 12 }}>
        Save signature
      </BigButton>
    </Modal>
  )
}

// Small elevation sketch of the pile, drawn from the log data.
function PileSketch({ p, isShaft, blank, finalDepth, topOfRock, socketTotal, tipElev }) {
  const navy = '#16233d', gold = '#c98f12', gray = '#8b93a1'
  const W = 190, H = 290, groundY = 26, drawH = 235
  const label = { fontSize: 8.5, fill: navy, fontFamily: 'Barlow, sans-serif' }

  if (isShaft) {
    const casing = Number(p.required_casing_depth_ft ?? 0)
    const D = Math.max(finalDepth, casing + socketTotal, 1)
    const s = drawH / D
    const y = (d) => groundY + d * s
    const rock = Math.min(topOfRock, D)
    const socketDrilled = Math.max(0, finalDepth - rock)
    const xL = 30, xR = 74
    return (
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ flex: '0 0 auto' }}>
        <defs>
          <pattern id="rockhatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="6" stroke={gray} strokeWidth="1" />
          </pattern>
        </defs>
        {/* ground */}
        <line x1="6" y1={groundY} x2="88" y2={groundY} stroke={navy} strokeWidth="1.5" />
        {[10, 16, 22].map((x) => <line key={x} x1={x} y1={groundY} x2={x - 4} y2={groundY + 5} stroke={navy} strokeWidth="1" />)}
        {/* rock on both sides of the shaft */}
        <rect x="6" y={y(rock)} width={xL - 6} height={y(D) - y(rock)} fill="url(#rockhatch)" />
        <rect x={xR} y={y(rock)} width={88 - xR} height={y(D) - y(rock)} fill="url(#rockhatch)" />
        <line x1="6" y1={y(rock)} x2="88" y2={y(rock)} stroke={gray} strokeWidth="1" />
        {/* shaft */}
        <rect x={xL} y={groundY} width={xR - xL} height={y(finalDepth || D) - groundY} fill={blank ? 'none' : '#eef1f6'} stroke={navy} strokeWidth="1.2" />
        {/* casing (heavier walls) */}
        <line x1={xL - 1.5} y1={groundY} x2={xL - 1.5} y2={y(casing)} stroke={navy} strokeWidth="3" />
        <line x1={xR + 1.5} y1={groundY} x2={xR + 1.5} y2={y(casing)} stroke={navy} strokeWidth="3" />
        {/* socket zone */}
        {!blank && socketDrilled > 0 && (
          <rect x={xL} y={y(rock)} width={xR - xL} height={y(finalDepth) - y(rock)} fill="#dfe6f0" stroke={navy} strokeWidth="1.2" />
        )}
        {/* labels */}
        <text x="95" y={groundY + 3} style={label}>Grade — 0 ft</text>
        <line x1="88" y1={y(casing)} x2="93" y2={y(casing)} stroke={gray} strokeWidth="0.8" />
        <text x="95" y={y(casing) + 3} style={label}>Casing {casing} ft</text>
        <line x1="88" y1={y(rock)} x2="93" y2={y(rock)} stroke={gray} strokeWidth="0.8" />
        <text x="95" y={y(rock) + 11} style={label}>Rock @ {blank ? '____' : `${rock} ft`}</text>
        <text x="95" y={(y(rock) + y(D)) / 2 + 3} style={{ ...label, fill: gold, fontWeight: 700 }}>
          Socket {blank ? '____' : `${socketDrilled} ft`}
        </text>
        <text x="95" y={(y(rock) + y(D)) / 2 + 13} style={{ ...label, fill: gray }}>req {socketTotal} ft</text>
        <line x1="88" y1={y(finalDepth || D)} x2="93" y2={y(finalDepth || D)} stroke={gray} strokeWidth="0.8" />
        <text x="95" y={y(finalDepth || D) + 3} style={{ ...label, fontWeight: 700 }}>
          Tip {blank ? '____' : `${finalDepth} ft`}
        </text>
      </svg>
    )
  }

  // driven pile
  const L = Number(p.length_ft ?? 60)
  const E = finalDepth || 0
  const D = Math.max(L, E, 1)
  const s = (drawH - 14) / D
  const gy = groundY + 14
  const y = (d) => gy + d * s
  const stickup = Math.max(0, L - E)
  const xL = 46, xR = 60
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ flex: '0 0 auto' }}>
      <line x1="6" y1={gy} x2="88" y2={gy} stroke={navy} strokeWidth="1.5" />
      {[10, 16, 22, 78, 84].map((x) => <line key={x} x1={x} y1={gy} x2={x - 4} y2={gy + 5} stroke={navy} strokeWidth="1" />)}
      {/* pile */}
      <rect x={xL} y={gy - stickup * s} width={xR - xL} height={(blank ? L : E + stickup) * s}
        fill={blank ? 'none' : '#eef1f6'} stroke={navy} strokeWidth="1.2" />
      <line x1={(xL + xR) / 2} y1={gy - stickup * s} x2={(xL + xR) / 2} y2={y(blank ? L : E)} stroke={navy} strokeWidth="0.7" strokeDasharray="3 2" />
      {/* labels */}
      <text x="95" y={gy + 3} style={label}>Grade — 0 ft</text>
      <text x="95" y={gy - 8} style={{ ...label, fill: gray }}>{p.description} · {L} ft long</text>
      <text x="95" y={(gy + y(blank ? L : E)) / 2} style={{ ...label, fill: gold, fontWeight: 700 }}>
        Embedment {blank ? '____' : `${E} ft`}
      </text>
      <line x1="88" y1={y(blank ? L : E)} x2="93" y2={y(blank ? L : E)} stroke={gray} strokeWidth="0.8" />
      <text x="95" y={y(blank ? L : E) + 3} style={{ ...label, fontWeight: 700 }}>
        Tip {blank ? '____' : `${E} ft`}
      </text>
      <text x="95" y={y(blank ? L : E) + 13} style={{ ...label, fill: gray }}>
        {tipElev != null ? `elev ${tipElev} ft` : `req tip elev ${p.required_tip_elev_ft ?? '—'} ft`}
      </text>
    </svg>
  )
}

function emptyRows(n, cols) {
  return Array.from({ length: n }, (_, i) => (
    <tr className="blankrow" key={i}>
      {Array.from({ length: cols }, (_, j) => <td key={j}>&nbsp;</td>)}
    </tr>
  ))
}

function blankOrRealBlowColumns(blank, blows, pile) {
  const rows = blank
    ? Array.from({ length: Math.round(Number(pile.length_ft) || 60) }, (_, i) => ({ depth_ft: i + 1, blank: true }))
    : blows
  const perCol = Math.ceil(rows.length / Math.min(3, Math.max(1, Math.ceil(rows.length / 22))))
  const out = []
  for (let i = 0; i < rows.length; i += perCol) out.push(rows.slice(i, i + perCol))
  return out
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
