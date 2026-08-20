import React, { useEffect, useState } from 'react'
import {
  getPileBundle, getEquipment, startDay, endDay, addEvent, updateEvent, addBlow, addBlowRun, deleteBlow,
  failPile, setPileStatus, isDriving, openObstruction, fmtTime, todayStr,
} from '../lib/db.js'
import { BigButton, Modal, NumPad, Chips, NoteFab, Loading, ErrBox } from '../components/ui.jsx'
import { Timeline, DaysCard } from './ShaftLog.jsx'

const OBSTRUCTION_TYPES = ['Boulder', 'Timber', 'Old concrete', 'Debris', 'Unknown']
const FAIL_REASONS = ['Broke / damaged', 'Out of position', 'Refused early', 'Obstruction', 'Other']
const CRITERIA = ['Tip elevation', 'Blow count', 'Practical refusal']

export default function DriveLog({ pile, job, onExport, onExit }) {
  const [bundle, setBundle] = useState(null)
  const [equip, setEquip] = useState([])
  const [err, setErr] = useState(null)
  const [modal, setModal] = useState(null)
  const [busy, setBusy] = useState(false)
  const [entry, setEntry] = useState('')
  const [stroke, setStroke] = useState(null)

  const reload = () => getPileBundle(pile.id).then(setBundle).catch((e) => setErr(e.message))

  useEffect(() => {
    reload()
    getEquipment(job.id).then(setEquip).catch(() => {})
  }, [pile.id])

  if (err) return <div className="screen"><ErrBox>{err}</ErrBox></div>
  if (!bundle) return <div className="screen"><Loading /></div>

  const { pile: p, days, events, blows } = bundle
  const driving = isDriving(events)
  const obst = openObstruction(events)
  const today = days.find((d) => d.work_date === todayStr())
  const driveStart = [...events].reverse().find((e) => e.event_type === 'drive_start')
  const startDepth = Number(driveStart?.data?.start_depth_ft ?? 0)
  const lastBlow = blows[blows.length - 1]
  const nextDepth = (lastBlow ? lastBlow.depth_ft : startDepth) + 1
  const curStroke = stroke ?? Number(lastBlow?.stroke_ft ?? 5)
  const totalBlows = blows.reduce((s, b) => s + b.blows, 0)

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

  const ensureDay = async () => {
    if (!today?.day_start) {
      setModal({ kind: 'day' })
      return false
    }
    return true
  }

  const logBlow = run(async () => {
    if (entry === '') return
    const n = parseInt(entry, 10)
    if (isNaN(n)) return
    // 0 is valid — the pile dropped through this foot without a full blow
    await addBlow(p.id, nextDepth, n, curStroke)
    setEntry('')
  })

  const hitObstruction = run(async () => {
    const ev = await addEvent(p.id, 'obstruction_hit', { depth_ft: lastBlow?.depth_ft ?? startDepth, type: 'Unknown' })
    setModal({ kind: 'obst_type', eventId: ev.id, data: ev.data })
  })

  return (
    <div className="screen">
      <div className="statusband">
        <div>
          <div className="lbl">Pile</div>
          <div className="big">{p.label}</div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div className="lbl">Total blows</div>
          <div className="big gold">{totalBlows}</div>
        </div>
        <div style={{ textAlign: 'right', fontSize: '0.8rem', lineHeight: 1.5 }}>
          <div>{p.description} · {p.length_ft} ft</div>
          <div>Tip elev: <b>{p.required_tip_elev_ft} ft</b></div>
          <div>{p.driving_criteria}</div>
        </div>
      </div>

      {p.status === 'rejected' ? (
        <ErrBox>This pile was rejected — see the log below. Its replacement is on the pile list.</ErrBox>
      ) : !driving && p.status !== 'complete' ? (
        <BigButton color="gold" disabled={busy}
          onClick={async () => { if (await ensureDay()) setModal({ kind: 'drive_start' }) }}>
          Start driving
          {!today?.day_start && <small>Will ask which rig first</small>}
        </BigButton>
      ) : null}

      {driving && (
        <>
          {/* the per-foot rhythm */}
          <div className="card">
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
              <div className="cond" style={{ fontSize: '2.2rem', fontWeight: 700 }}>
                FT {nextDepth}
              </div>
              <div className="stepper">
                <button onClick={() => setStroke(Math.max(1, curStroke - 0.5))}>−</button>
                <span className="val">{curStroke} ft</span>
                <button onClick={() => setStroke(curStroke + 0.5)}>+</button>
              </div>
            </div>
            <div className="muted" style={{ textAlign: 'right', marginTop: -6, marginBottom: 6 }}>hammer stroke</div>
            <div className="np-display">{entry || '0'}<span className="unit">blows</span></div>
            <div className="np-grid">
              {['1','2','3','4','5','6','7','8','9','⌫','0','LOG'].map((k) => (
                <button key={k}
                  className={`np-key ${k === '⌫' || k === 'LOG' ? 'fn' : ''}`}
                  style={k === 'LOG' ? { background: 'var(--gold)', color: 'var(--navy)', fontWeight: 700 } : {}}
                  onClick={() => {
                    if (k === 'LOG') return logBlow()
                    if (k === '⌫') return setEntry((v) => v.slice(0, -1))
                    if (entry.length < 3) setEntry((v) => v + k)
                  }}>
                  {k}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
              <button className="chip" disabled={busy} onClick={() => setModal({ kind: 'run' })}>
                ⇩ Pile ran
              </button>
              {lastBlow && (
                <button className="chip" disabled={busy}
                  onClick={run(async () => { await deleteBlow(lastBlow.id) })}>
                  ↩ Undo ft {lastBlow.depth_ft} ({lastBlow.blows} blows)
                </button>
              )}
            </div>
          </div>

          {obst ? (
            <BigButton color="orange" disabled={busy}
              onClick={run(() => addEvent(p.id, 'obstruction_cleared', { depth_ft: lastBlow?.depth_ft ?? startDepth }))}>
              Obstruction cleared
              <small>Hit at {fmtTime(obst.ts)}</small>
            </BigButton>
          ) : (
            <BigButton color="orange" disabled={busy} onClick={hitObstruction}>
              ⚠ Obstruction
            </BigButton>
          )}

          <div className="btnrow">
            <BigButton color="green" disabled={busy} onClick={() => setModal({ kind: 'drive_end' })}>
              End of drive
            </BigButton>
            <BigButton color="red" disabled={busy} onClick={() => setModal({ kind: 'fail' })}>
              Pile failed
            </BigButton>
          </div>
        </>
      )}

      {/* recent blows */}
      {blows.length > 0 && (
        <div className="card">
          <ul className="tl">
            {[...blows].reverse().slice(0, 8).map((b) => (
              <li key={b.id}>
                <span className="t">ft {b.depth_ft}</span>
                <span className="what">
                  {b.blows === 0 ? <b>ran</b> : <b>{b.blows} blows</b>}
                  {b.stroke_ft != null && <> · stroke {b.stroke_ft} ft</>}
                </span>
              </li>
            ))}
          </ul>
          {blows.length > 8 && <div className="muted">…{blows.length - 8} more in the full log</div>}
        </div>
      )}

      <Timeline events={events} />
      <DaysCard days={days} />
      <div className="btnrow">
        {today?.day_start && !today?.day_end && (
          <BigButton color="ghost" disabled={busy} onClick={run(() => endDay(p.id))}>End day</BigButton>
        )}
        <BigButton color="ghost" onClick={onExport}>View / export log</BigButton>
      </div>

      <NoteFab onSave={async (text) => { await addEvent(p.id, 'note', { text }); await reload() }} />

      {/* ---------------- modals ---------------- */}
      {modal?.kind === 'day' && (
        <DayModal equip={equip} onClose={() => setModal(null)}
          onStart={run(async (equipmentId, engineer) => {
            await startDay(p.id, { equipmentId, engineer })
            setModal({ kind: 'drive_start' })
          })}
        />
      )}
      {modal?.kind === 'drive_start' && (
        <NumPad title="Start driving" sub="Starting depth (usually 0)" unit="ft" initial="0"
          submitLabel="Start" allowDecimal={false}
          onCancel={() => setModal(null)}
          onSubmit={run(async (v) => {
            await addEvent(p.id, 'drive_start', { start_depth_ft: v })
            if (p.status === 'not_started') await setPileStatus(p.id, 'in_progress')
            setModal(null)
          })}
        />
      )}
      {modal?.kind === 'drive_end' && (
        <NumPad title="End of drive" sub={`Last foot logged: ${lastBlow?.depth_ft ?? startDepth} ft`}
          unit="ft final" initial={String(lastBlow?.depth_ft ?? '')}
          onCancel={() => setModal(null)}
          submitLabel="Next"
          onSubmit={(v) => setModal({ kind: 'criteria', finalDepth: v })}
        />
      )}
      {modal?.kind === 'criteria' && (
        <CriteriaModal onClose={() => setModal(null)}
          onPick={run(async (crit) => {
            await addEvent(p.id, 'drive_end', { end_depth_ft: modal.finalDepth, criteria_met: crit })
            await setPileStatus(p.id, 'complete')
            setModal(null)
          })}
        />
      )}
      {modal?.kind === 'run' && (
        <NumPad title="Pile ran" sub={`Currently at ${lastBlow?.depth_ft ?? startDepth} ft — ran to what depth?`}
          unit="ft" allowDecimal={false} submitLabel="Log run"
          onCancel={() => setModal(null)}
          onSubmit={run(async (v) => {
            const from = (lastBlow?.depth_ft ?? startDepth) + 1
            if (v < from) return
            await addBlowRun(p.id, from, v)
            await addEvent(p.id, 'pile_run', { from_ft: from - 1, to_ft: v })
            setModal(null)
          })}
        />
      )}
      {modal?.kind === 'obst_type' && (
        <ObstTypeModal onClose={() => setModal(null)}
          onPick={run(async (type, note) => {
            await updateEvent(modal.eventId, { ...modal.data, type, ...(note ? { note } : {}) })
            setModal(null)
          })}
        />
      )}
      {modal?.kind === 'fail' && (
        <FailModal onClose={() => setModal(null)}
          onPick={run(async (reason) => {
            const replacement = await failPile(p, reason, lastBlow?.depth_ft ?? startDepth)
            setModal({ kind: 'failed_done', replacement })
          })}
        />
      )}
      {modal?.kind === 'failed_done' && (
        <Modal title="Pile rejected" onClose={onExit}>
          <p style={{ marginBottom: 14 }}>
            <b>{p.label}</b> is marked rejected, and replacement pile{' '}
            <b>{modal.replacement.label}</b> has been added to the pile list.
          </p>
          <BigButton color="gold" onClick={onExit}>Back to pile list</BigButton>
        </Modal>
      )}
    </div>
  )
}

function DayModal({ equip, onClose, onStart }) {
  const [eqId, setEqId] = useState(equip[0]?.id ?? '')
  const [engineer, setEngineer] = useState('')
  const chosen = equip.find((e) => e.id === eqId)
  return (
    <Modal title="Start day" sub="Which rig is driving this pile?" onClose={onClose}>
      <select className="field" value={eqId} onChange={(e) => setEqId(e.target.value)}>
        {equip.map((e) => (
          <option key={e.id} value={e.id}>{e.name}</option>
        ))}
      </select>
      {chosen?.hammer_make_model && (
        <div className="muted" style={{ marginBottom: 10 }}>
          Hammer: {chosen.hammer_make_model} ({chosen.hammer_type}), rated{' '}
          {Number(chosen.rated_energy_ftlbs).toLocaleString()} ft-lbs — fills in automatically.
        </div>
      )}
      <input className="field" placeholder="Engineer (optional)" value={engineer} onChange={(e) => setEngineer(e.target.value)} />
      <BigButton color="gold" disabled={!eqId} onClick={() => onStart(eqId, engineer.trim() || null)}>
        Start day
      </BigButton>
    </Modal>
  )
}

function ObstTypeModal({ onPick, onClose }) {
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

function CriteriaModal({ onPick, onClose }) {
  const [crit, setCrit] = useState(null)
  return (
    <Modal title="Driving criteria met?" onClose={onClose}>
      <Chips options={CRITERIA} value={crit} onChange={setCrit} />
      <BigButton color="green" disabled={!crit} onClick={() => onPick(crit)}>
        Complete pile
      </BigButton>
    </Modal>
  )
}

function FailModal({ onPick, onClose }) {
  const [reason, setReason] = useState(null)
  return (
    <Modal title="Pile failed" sub="This rejects the pile and creates its replacement automatically." onClose={onClose}>
      <Chips options={FAIL_REASONS} value={reason} onChange={setReason} />
      <BigButton color="red" disabled={!reason} onClick={() => onPick(reason)}>
        Reject &amp; create replacement
      </BigButton>
    </Modal>
  )
}
