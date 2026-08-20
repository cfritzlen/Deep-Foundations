import React, { useEffect, useState } from 'react'
import {
  getPileBundle, getEquipment, startDay, endDay, addEvent, updateEvent, updatePile,
  setPileStatus, addTicket, updateTicket, ticketPhotoUrl, scanTicket, currentDepth, isDrilling,
  openObstruction, isPouring, fmtTime, fmtDate, todayStr,
} from '../lib/db.js'
import { BigButton, Modal, NumPad, Chips, NoteFab, Loading, ErrBox } from '../components/ui.jsx'

const OBSTRUCTION_TYPES = ['Boulder', 'Timber', 'Old concrete', 'Debris', 'Unknown']

export default function ShaftLog({ pile, job, onExport }) {
  const [bundle, setBundle] = useState(null)
  const [equip, setEquip] = useState([])
  const [err, setErr] = useState(null)
  const [tab, setTab] = useState('drill')
  const [modal, setModal] = useState(null) // {kind, ...}
  const [busy, setBusy] = useState(false)
  const [muteMix, setMuteMix] = useState(false) // "dismiss for rest of pour"
  const [viewPhoto, setViewPhoto] = useState(null) // full-screen ticket photo

  const reload = () =>
    getPileBundle(pile.id).then(setBundle).catch((e) => setErr(e.message))

  useEffect(() => {
    reload()
    getEquipment(job.id).then(setEquip).catch(() => {})
  }, [pile.id])

  if (err) return <div className="screen"><ErrBox>{err}</ErrBox></div>
  if (!bundle) return <div className="screen"><Loading /></div>

  const { pile: p, days, events, tickets } = bundle
  const depth = currentDepth(events)
  const drilling = isDrilling(events)
  const obst = openObstruction(events)
  const pouring = isPouring(events)
  const requiredSocket = Number(p.required_socket_depth_ft ?? 0)
  const socketExt = Number(p.socket_extension_ft ?? 0)
  const today = days.find((d) => d.work_date === todayStr())
  const cageSet = [...events].reverse().find((e) => e.event_type === 'cage_set')
  const pourStart = [...events].reverse().find((e) => e.event_type === 'pour_start')
  const pourEnd = [...events].reverse().find((e) => e.event_type === 'pour_end')
  const inspections = events.filter((e) => e.event_type === 'inspection')
  const lastInspection = inspections[inspections.length - 1]
  const totalCy = tickets.reduce((s, t) => s + Number(t.volume_cy || 0), 0)
  const rockEvent = [...events].reverse().find((e) => e.event_type === 'rock_reached')
  const topOfRock = rockEvent ? Number(rockEvent.data.depth_ft) : null
  const socketDrilled = topOfRock != null ? Math.max(0, depth - topOfRock) : null

  const run = (fn) => async (...args) => {
    if (busy) return
    setBusy(true)
    try {
      await fn(...args)
      await reload()
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  const ensureStarted = async () => {
    if (!today?.day_start) await startDay(p.id, { equipmentId: equip[0]?.id ?? null })
    if (p.status === 'not_started') await setPileStatus(p.id, 'in_progress')
  }

  const hitObstruction = run(async () => {
    await ensureStarted()
    const ev = await addEvent(p.id, 'obstruction_hit', { depth_ft: depth, type: 'Unknown' })
    setModal({ kind: 'obst_type', eventId: ev.id, data: ev.data })
  })

  return (
    <div className="screen">
      {/* status band */}
      <div className="statusband">
        <div>
          <div className="lbl">Shaft</div>
          <div className="big">{p.label}</div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div className="lbl">Depth</div>
          <div className="big gold">{depth} ft</div>
        </div>
        <div style={{ textAlign: 'right', fontSize: '0.8rem', lineHeight: 1.5 }}>
          <div>Casing req: <b>{p.required_casing_depth_ft} ft</b></div>
          <div>
            Socket:{' '}
            <b>
              {socketDrilled != null ? `${socketDrilled} / ` : 'req '}
              {requiredSocket + socketExt} ft
              {socketExt > 0 && <span style={{ color: 'var(--gold)' }}> (+{socketExt})</span>}
            </b>
          </div>
          {topOfRock != null && <div>Rock @ <b>{topOfRock} ft</b></div>}
        </div>
      </div>

      {!today?.day_start && (
        <BigButton color="gold" disabled={busy} onClick={run(() => ensureStarted())}>
          Start day
          <small>Stamps today's start time</small>
        </BigButton>
      )}

      {/* tabs */}
      <div className="tabs">
        <button className={`tab ${tab === 'drill' ? 'active' : ''}`} onClick={() => setTab('drill')}>Drilling</button>
        <button className={`tab ${tab === 'inspect' ? 'active' : ''}`} onClick={() => setTab('inspect')}>
          Inspection {lastInspection?.data?.result === 'pass' && <span className="done">✓</span>}
        </button>
        <button className={`tab ${tab === 'pour' ? 'active' : ''}`} onClick={() => setTab('pour')}>
          Cage &amp; Pour {pourEnd && <span className="done">✓</span>}
        </button>
      </div>

      {/* ---------------- DRILLING ---------------- */}
      {tab === 'drill' && (
        <>
          {obst ? (
            <BigButton color="orange" disabled={busy}
              onClick={run(() => addEvent(p.id, 'obstruction_cleared', { depth_ft: depth }))}>
              Obstruction cleared
              <small>Hit at {fmtTime(obst.ts)} — {obst.data?.type ?? 'unknown'}</small>
            </BigButton>
          ) : (
            <BigButton color="orange" disabled={busy} onClick={hitObstruction}>
              ⚠ Obstruction
              <small>One tap — stamps time &amp; depth now</small>
            </BigButton>
          )}

          {!drilling ? (
            <BigButton disabled={busy} onClick={() => setModal({ kind: 'drill_start' })}>
              Start drilling
              {topOfRock == null && depth > 0 && <small>Still in overburden</small>}
              {topOfRock != null && <small>In rock — {socketDrilled} ft of socket so far</small>}
            </BigButton>
          ) : (
            <BigButton color="green" disabled={busy} onClick={() => setModal({ kind: 'drill_end' })}>
              Stop drilling
              {topOfRock == null && <small>Still in overburden</small>}
              {topOfRock != null && <small>In rock — {socketDrilled} ft of socket so far</small>}
            </BigButton>
          )}

          <div className="chips" style={{ marginTop: 2 }}>
            <button className="chip" disabled={busy} onClick={() => setModal({ kind: 'rock' })}>
              ⛰ {topOfRock == null ? 'Top of rock' : `Rock @ ${topOfRock} ft`}
            </button>
            <button className="chip" disabled={busy} onClick={() => setModal({ kind: 'socket_ext' })}>
              + Extend socket
            </button>
          </div>
        </>
      )}

      {/* ---------------- INSPECTION ---------------- */}
      {tab === 'inspect' && (
        <>
          <div className="btnrow">
            <BigButton color="green" disabled={busy}
              onClick={() => setModal({ kind: 'inspection', result: 'pass' })}>
              Socket pass
            </BigButton>
            <BigButton color="red" disabled={busy}
              onClick={() => setModal({ kind: 'inspection', result: 'fail' })}>
              Socket fail
            </BigButton>
          </div>
          {inspections.length > 0 && (
            <div className="card">
              <ul className="tl">
                {inspections.map((e) => (
                  <li key={e.id}>
                    <span className="t">{fmtTime(e.ts)}</span>
                    <span className={`what ${e.data.result === 'pass' ? 'pass' : 'fail'}`}>
                      <b>{e.data.result === 'pass' ? 'PASS' : 'FAIL'}</b> — {e.data.inspector || 'inspector n/a'}
                      {e.data.note ? ` · ${e.data.note}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      {/* ---------------- CAGE & POUR ---------------- */}
      {tab === 'pour' && (
        <>
          {p.mix && (
            <div className="card">
              <div className="kv"><span>Mix design</span><b>{p.mix.code} — {p.mix.strength_psi} psi</b></div>
              <div className="kv"><span className="muted">{p.mix.description}</span></div>
              <div className="kv"><span>Supplier</span><b>{p.mix.supplier}</b></div>
            </div>
          )}

          {!cageSet ? (
            <BigButton disabled={busy} onClick={run(async () => { await ensureStarted(); await addEvent(p.id, 'cage_set', {}) })}>
              Cage set
              <small>Stamps time now</small>
            </BigButton>
          ) : (
            <div className="card">
              <div className="kv"><span>Cage set</span><b>{fmtTime(cageSet.ts)}</b></div>
              {!pourStart && (
                <div className="kv">
                  <span>Time since cage set</span>
                  <b className={minutesSince(cageSet.ts) > 60 ? 'warn' : ''}>{minutesSince(cageSet.ts)} min</b>
                </div>
              )}
            </div>
          )}

          {cageSet && !pourStart && (
            <BigButton color="green" disabled={busy}
              onClick={run(async () => { setMuteMix(false); await addEvent(p.id, 'pour_start', {}) })}>
              Start pour
            </BigButton>
          )}

          {pouring && (
            <>
              <BigButton color="gold" disabled={busy} onClick={() => setModal({ kind: 'ticket' })}>
                + Concrete truck
                <small>Photo of ticket, tests</small>
              </BigButton>
              <BigButton color="green" disabled={busy} onClick={() => setModal({ kind: 'pour_end' })}>
                End pour
              </BigButton>
            </>
          )}

          {tickets.length > 0 && (
            <div className="card">
              {tickets.map((t, i) => {
                const cum = tickets.slice(0, i + 1).reduce((s, x) => s + Number(x.volume_cy || 0), 0)
                return (
                  <div key={t.id} className="ticketrow" style={{ cursor: 'pointer' }}
                    onClick={() => setModal({ kind: 'ticket', ticket: t })}>
                    {t.photo_path && (
                      <img src={ticketPhotoUrl(t.photo_path)} alt=""
                        onClick={(e) => { e.stopPropagation(); setViewPhoto(ticketPhotoUrl(t.photo_path)) }} />
                    )}
                    <div style={{ flex: 1 }}>
                      <div className="tno">Truck {t.truck_no || '—'} · Ticket {t.ticket_no || '—'} · {t.volume_cy ?? '—'} CY</div>
                      <div className="muted">
                        {t.supplier ? `${t.supplier} · ` : ''}
                        {t.slump_in != null ? `Slump ${t.slump_in}" · ` : ''}
                        {t.air_pct != null ? `Air ${t.air_pct}% · ` : ''}
                        {t.temp_f != null ? `${t.temp_f}°F · ` : ''}
                        {t.cylinders ? `${t.cylinders} cyl · ` : ''}
                        cum {cum} CY
                      </div>
                    </div>
                    <span className="muted">{fmtTime(t.ts)}</span>
                  </div>
                )
              })}
              <div className="kv" style={{ marginTop: 6 }}><span>Total placed</span><b>{totalCy} CY</b></div>
              <div className="muted" style={{ fontSize: '0.78rem', marginTop: 4 }}>
                Tap a truck to add test results · tap its photo to view the ticket
              </div>
            </div>
          )}

          {pourEnd && p.status !== 'complete' && (
            <BigButton color="green" disabled={busy} onClick={run(() => setPileStatus(p.id, 'complete'))}>
              Mark shaft complete
            </BigButton>
          )}
        </>
      )}

      {/* timeline + days + export */}
      <Timeline events={events} />
      <DaysCard days={days} />
      <div className="btnrow">
        {today?.day_start && !today?.day_end && (
          <BigButton color="ghost" disabled={busy} onClick={run(() => endDay(p.id))}>
            End day
          </BigButton>
        )}
        <BigButton color="ghost" onClick={onExport}>View / export log</BigButton>
      </div>

      <NoteFab onSave={async (text) => { await addEvent(p.id, 'note', { text }); await reload() }} />

      {/* ---------------- modals ---------------- */}
      {modal?.kind === 'drill_start' && (
        <NumPad title="Start drilling" sub="Starting depth" unit="ft" initial={depth || ''}
          submitLabel="Start"
          onCancel={() => setModal(null)}
          onSubmit={run(async (v) => {
            await ensureStarted()
            await addEvent(p.id, 'drill_start', { start_depth_ft: v })
            setModal(null)
          })}
        />
      )}
      {modal?.kind === 'drill_end' && (
        <NumPad title="Stop drilling" sub="Depth reached" unit="ft" initial={depth || ''}
          submitLabel="Stop"
          onCancel={() => setModal(null)}
          onSubmit={run(async (v) => {
            await addEvent(p.id, 'drill_end', { end_depth_ft: v })
            setModal(null)
          })}
        />
      )}
      {modal?.kind === 'rock' && (
        <NumPad title="Top of rock" sub="Depth where rock was encountered — splits the log into overburden vs socket"
          unit="ft" initial={depth || ''} submitLabel="Set"
          onCancel={() => setModal(null)}
          onSubmit={run(async (v) => {
            await addEvent(p.id, 'rock_reached', { depth_ft: v })
            setModal(null)
          })}
        />
      )}
      {modal?.kind === 'socket_ext' && (
        <NumPad title="Extend socket" sub={`Current requirement: ${requiredSocket + socketExt} ft of socket`}
          unit="ft added" initial="5" submitLabel="Add"
          onCancel={() => setModal(null)}
          onSubmit={run(async (v) => {
            await updatePile(p.id, { socket_extension_ft: socketExt + v })
            await addEvent(p.id, 'socket_extension', { added_ft: v, new_required_socket_ft: requiredSocket + socketExt + v })
            setModal(null)
          })}
        />
      )}
      {modal?.kind === 'obst_type' && (
        <ObstructionTypeModal
          onPick={run(async (type, note) => {
            await updateEvent(modal.eventId, { ...modal.data, type, ...(note ? { note } : {}) })
            setModal(null)
          })}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.kind === 'inspection' && (
        <InspectionModal result={modal.result}
          onClose={() => setModal(null)}
          onSave={run(async (inspector, note) => {
            await ensureStarted()
            await addEvent(p.id, 'inspection', { result: modal.result, inspector, note })
            setModal(modal.result === 'fail' ? { kind: 'socket_ext' } : null)
          })}
        />
      )}
      {modal?.kind === 'ticket' && (
        <TicketModal
          mix={p.mix}
          existing={modal.ticket ?? null}
          muteMix={muteMix}
          onMuteRestOfPour={() => setMuteMix(true)}
          onMismatch={async (found) => {
            await addEvent(p.id, 'mix_warning', { found, expected: `${p.mix.code} (${p.mix.strength_psi} psi)` })
          }}
          onViewPhoto={setViewPhoto}
          onClose={() => setModal(null)}
          onSave={run(async (fields, photo) => {
            if (modal.ticket) await updateTicket(p.id, modal.ticket.id, fields, photo)
            else await addTicket(p.id, fields, photo)
            setModal(null)
          })}
        />
      )}
      {viewPhoto && (
        <div className="overlay photoview" onClick={() => setViewPhoto(null)}>
          <img src={viewPhoto} alt="Concrete ticket" />
        </div>
      )}
      {modal?.kind === 'pour_end' && (
        <NumPad title="End pour" sub={`Tickets so far total ${totalCy} CY`} unit="CY total" initial={totalCy || ''}
          submitLabel="End pour"
          onCancel={() => setModal(null)}
          onSubmit={run(async (v) => {
            await addEvent(p.id, 'pour_end', { total_cy: v })
            setMuteMix(false)
            setModal(null)
          })}
        />
      )}
    </div>
  )
}

function minutesSince(ts) {
  return Math.round((Date.now() - new Date(ts).getTime()) / 60000)
}

function ObstructionTypeModal({ onPick, onClose }) {
  const [type, setType] = useState(null)
  const [note, setNote] = useState('')
  return (
    <Modal title="Obstruction logged ✓" sub="Time and depth are already stamped. What is it?" onClose={onClose}>
      <Chips options={OBSTRUCTION_TYPES} value={type} onChange={setType} />
      <input className="field" placeholder="Optional note" value={note} onChange={(e) => setNote(e.target.value)} />
      <BigButton color="gold" disabled={!type} onClick={() => onPick(type, note.trim())}>Save</BigButton>
    </Modal>
  )
}

function InspectionModal({ result, onClose, onSave }) {
  const [inspector, setInspector] = useState('')
  const [note, setNote] = useState('')
  return (
    <Modal title={result === 'pass' ? 'Socket inspection — PASS' : 'Socket inspection — FAIL'}
      sub={result === 'fail' ? "You'll be asked how much socket to add next." : ''}
      onClose={onClose}>
      <input className="field" placeholder="Inspector (name / firm)" value={inspector} onChange={(e) => setInspector(e.target.value)} />
      <input className="field" placeholder="Optional note" value={note} onChange={(e) => setNote(e.target.value)} />
      <BigButton color={result === 'pass' ? 'green' : 'red'} onClick={() => onSave(inspector.trim(), note.trim())}>
        Record {result}
      </BigButton>
    </Modal>
  )
}

function TicketModal({ mix, existing, muteMix, onMuteRestOfPour, onMismatch, onViewPhoto, onClose, onSave }) {
  const [f, setF] = useState(() => existing ? {
    truck_no: existing.truck_no ?? '',
    ticket_no: existing.ticket_no ?? '',
    supplier: existing.supplier ?? '',
    volume_cy: existing.volume_cy ?? '',
    slump_in: existing.slump_in ?? '',
    air_pct: existing.air_pct ?? '',
    temp_f: existing.temp_f ?? '',
    cylinders: existing.cylinders ?? '',
  } : {})
  const [photo, setPhoto] = useState(null)
  const [scanning, setScanning] = useState(false)
  const [scanNote, setScanNote] = useState(null)
  const [warn, setWarn] = useState(null) // mismatch popup
  const set = (k) => (e) => setF((o) => ({ ...o, [k]: e.target.value }))
  const num = (v) => (v === '' || v == null ? null : Number(v))

  const doScan = async () => {
    setScanning(true)
    setScanNote(null)
    try {
      const r = await scanTicket(photo)
      setF((o) => ({
        ...o,
        truck_no: r.truck_no ?? o.truck_no,
        ticket_no: r.ticket_no ?? o.ticket_no,
        supplier: r.supplier ?? o.supplier,
        volume_cy: r.volume_cy ?? o.volume_cy,
      }))
      if (mix && (r.mix_code || r.strength_psi)) {
        const codeMatch = r.mix_code && mix.code &&
          r.mix_code.toLowerCase().replace(/[^a-z0-9]/g, '').includes(mix.code.toLowerCase().replace(/[^a-z0-9]/g, ''))
        const psiMatch = r.strength_psi && Number(r.strength_psi) === Number(mix.strength_psi)
        if (codeMatch || psiMatch) {
          setScanNote({ ok: true, text: `✓ Ticket mix ${r.mix_code ?? r.strength_psi + ' psi'} matches ${mix.code}` })
        } else {
          const found = `${r.mix_code ?? ''}${r.strength_psi ? ` (${r.strength_psi} psi)` : ''}`.trim() || 'an unreadable mix'
          setScanNote({ ok: false, text: `⚠ Ticket shows ${found} — this shaft calls for ${mix.code} (${mix.strength_psi} psi)` })
          onMismatch?.(found)
          if (!muteMix) setWarn({ found })
        }
      } else {
        setScanNote({ ok: true, text: '✓ Ticket read — check the fields below' })
      }
    } catch (e) {
      setScanNote({ ok: false, text: e.message })
    } finally {
      setScanning(false)
    }
  }

  const previewUrl = photo ? URL.createObjectURL(photo) : existing?.photo_path ? ticketPhotoUrl(existing.photo_path) : null

  // plain function (not a nested component) so inputs keep focus across renders
  const field = (label, k, mode) => (
    <label className="fwrap" key={k}>
      <span>{label}</span>
      <input className="field" inputMode={mode} value={f[k] ?? ''} onChange={set(k)} />
    </label>
  )

  return (
    <Modal title={existing ? `Truck ${existing.truck_no || ''} — edit` : 'Concrete truck'}
      sub={existing ? 'Add test results or fix anything, then save.' : 'Snap the ticket — everything else is optional.'}
      onClose={onClose}>
      <label className="bigbtn ghost" style={{ display: 'block', textAlign: 'center', lineHeight: 1.3 }}>
        {photo ? '📷 Retake photo' : existing?.photo_path ? '📷 Replace photo' : '📷 Photo of ticket'}
        <input type="file" accept="image/*" capture="environment" hidden
          onChange={(e) => { setPhoto(e.target.files?.[0] ?? null); setScanNote(null) }} />
      </label>
      {previewUrl && (
        <img className="ticket-preview" src={previewUrl} alt="Ticket"
          onClick={() => onViewPhoto?.(previewUrl)} />
      )}
      {photo && (
        <BigButton color="gold" disabled={scanning} onClick={doScan}>
          {scanning ? 'Reading ticket…' : '✨ Scan ticket'}
          {!scanning && <small>Fills in the fields from the photo</small>}
        </BigButton>
      )}
      {scanNote && (
        <div className={scanNote.ok ? 'card' : 'errbox'}
          style={scanNote.ok ? { padding: '10px 14px', color: 'var(--green)', fontWeight: 600 } : {}}>
          {scanNote.text}
        </div>
      )}
      <div className="btnrow">
        {field('Truck #', 'truck_no')}
        {field('Ticket #', 'ticket_no')}
      </div>
      {field('Concrete vendor', 'supplier')}
      {field('Volume — this load (CY)', 'volume_cy', 'decimal')}
      <div className="btnrow">
        {field('Slump (in)', 'slump_in', 'decimal')}
        {field('Air (%)', 'air_pct', 'decimal')}
      </div>
      <div className="btnrow">
        {field('Temp (°F)', 'temp_f', 'decimal')}
        {field('Cylinders', 'cylinders', 'numeric')}
      </div>
      <BigButton color="gold"
        onClick={() => onSave({
          truck_no: f.truck_no || null,
          ticket_no: f.ticket_no || null,
          supplier: f.supplier || null,
          volume_cy: num(f.volume_cy),
          slump_in: num(f.slump_in),
          air_pct: num(f.air_pct),
          temp_f: num(f.temp_f),
          cylinders: num(f.cylinders),
        }, photo)}>
        Save truck
      </BigButton>

      {warn && (
        <div className="overlay" style={{ zIndex: 70, alignItems: 'center', padding: 16 }}>
          <div className="card" style={{ borderTop: '8px solid var(--red)', maxWidth: 440, width: '100%', margin: 0 }}>
            <h3 className="cond" style={{ color: 'var(--red)', fontSize: '1.5rem', textTransform: 'uppercase', marginBottom: 8 }}>
              ⚠ Mix mismatch
            </h3>
            <p style={{ marginBottom: 6 }}>
              This ticket shows <b>{warn.found}</b>.
            </p>
            <p style={{ marginBottom: 14 }}>
              This shaft calls for <b>{mix.code} ({mix.strength_psi} psi)</b>. The mismatch has been
              stamped into the log.
            </p>
            <BigButton color="red" onClick={() => setWarn(null)}>
              Dismiss this ticket
            </BigButton>
            <BigButton color="ghost" onClick={() => { onMuteRestOfPour?.(); setWarn(null) }}>
              Dismiss for rest of pour
            </BigButton>
          </div>
        </div>
      )}
    </Modal>
  )
}

const EVENT_LABEL = {
  drill_start: 'Started drilling',
  drill_end: 'Stopped drilling',
  obstruction_hit: 'OBSTRUCTION',
  obstruction_cleared: 'Obstruction cleared',
  inspection: 'Inspection',
  socket_extension: 'Socket extended',
  cage_set: 'Cage set',
  rock_reached: 'Top of rock',
  pour_start: 'Pour started',
  pour_end: 'Pour ended',
  pile_failed: 'PILE FAILED',
  drive_start: 'Started driving',
  drive_end: 'End of drive',
  pile_run: 'Pile ran',
  mix_warning: 'MIX WARNING',
  signature: 'Log signed',
  note: 'Note',
}

export function Timeline({ events }) {
  const [showAll, setShowAll] = useState(false)
  if (!events.length) return null
  const shown = showAll ? events : events.slice(-3)
  return (
    <div className="card">
      <ul className="tl">
        {shown.map((e) => (
          <li key={e.id}>
            <span className="t">
              {new Date(e.ts).toLocaleDateString([], { month: 'numeric', day: 'numeric' })} {fmtTime(e.ts)}
            </span>
            <span className={`what ${e.event_type.startsWith('obstruction') ? 'obst' : ''} ${e.event_type === 'pile_failed' || e.event_type === 'mix_warning' ? 'fail' : ''}`}>
              <b>{EVENT_LABEL[e.event_type] ?? e.event_type}</b> {describeEvent(e)}
            </span>
          </li>
        ))}
      </ul>
      {events.length > 3 && (
        <button className="chip" style={{ marginTop: 8 }} onClick={() => setShowAll(!showAll)}>
          {showAll ? '▴ Show less' : `▾ Full history (${events.length})`}
        </button>
      )}
    </div>
  )
}

export function describeEvent(e) {
  const d = e.data || {}
  switch (e.event_type) {
    case 'drill_start': return `at ${d.start_depth_ft ?? '?'} ft`
    case 'drill_end': return `at ${d.end_depth_ft ?? '?'} ft${d.note ? ` — ${d.note}` : ''}`
    case 'obstruction_hit': return `at ${d.depth_ft ?? '?'} ft — ${d.type ?? 'unknown'}${d.note ? ` (${d.note})` : ''}`
    case 'obstruction_cleared': return `at ${d.depth_ft ?? '?'} ft`
    case 'inspection': return `${(d.result || '').toUpperCase()}${d.inspector ? ` — ${d.inspector}` : ''}${d.note ? ` · ${d.note}` : ''}`
    case 'socket_extension': return `+${d.added_ft} ft (socket now ${d.new_required_socket_ft} ft)`
    case 'rock_reached': return `at ${d.depth_ft} ft`
    case 'pour_end': return d.total_cy != null ? `${d.total_cy} CY placed` : ''
    case 'drive_start': return `at ${d.start_depth_ft ?? 0} ft`
    case 'drive_end': return `at ${d.end_depth_ft ?? '?'} ft${d.criteria_met ? ` — ${d.criteria_met}` : ''}`
    case 'pile_run': return `from ${d.from_ft} ft to ${d.to_ft} ft`
    case 'pile_failed': return `${d.reason ?? ''}${d.depth_ft != null ? ` at ${d.depth_ft} ft` : ''}`
    case 'mix_warning': return `ticket showed ${d.found} — pile calls for ${d.expected}`
    case 'signature': return `${d.role ?? ''} — ${d.name ?? ''}`
    case 'note': return d.text ?? ''
    default: return ''
  }
}

export function DaysCard({ days }) {
  const [showAll, setShowAll] = useState(false)
  if (!days.length) return null
  const shown = showAll ? days : days.slice(-1)
  return (
    <div className="card">
      {shown.map((d) => (
        <div key={d.id} className="kv">
          <span>{fmtDate(d.work_date)}</span>
          <b>
            {d.day_start ? fmtTime(d.day_start) : '—'} – {d.day_end ? fmtTime(d.day_end) : 'working'}
            {d.equipment ? ` · ${d.equipment.name.split('—')[0].trim()}` : ''}
          </b>
        </div>
      ))}
      {days.length > 1 && (
        <button className="chip" style={{ marginTop: 8 }} onClick={() => setShowAll(!showAll)}>
          {showAll ? '▴ Show less' : `▾ All days (${days.length})`}
        </button>
      )}
    </div>
  )
}
