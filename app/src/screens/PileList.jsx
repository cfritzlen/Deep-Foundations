import React, { useEffect, useMemo, useState } from 'react'
import { getPiles } from '../lib/db.js'
import { Loading, ErrBox } from '../components/ui.jsx'

const STATUS_LABEL = {
  not_started: 'Not started',
  in_progress: 'In progress',
  complete: 'Complete',
  rejected: 'Rejected',
}

export default function PileList({ job, onPick }) {
  const [piles, setPiles] = useState(null)
  const [err, setErr] = useState(null)
  const [q, setQ] = useState('')

  useEffect(() => {
    getPiles(job.id).then(setPiles).catch((e) => setErr(e.message))
  }, [job.id])

  const shown = useMemo(() => {
    if (!piles) return null
    const needle = q.trim().toLowerCase()
    return needle ? piles.filter((p) => p.label.toLowerCase().includes(needle)) : piles
  }, [piles, q])

  const counts = useMemo(() => {
    const c = { in_progress: 0, complete: 0, rejected: 0 }
    piles?.forEach((p) => { if (c[p.status] !== undefined) c[p.status]++ })
    return c
  }, [piles])

  return (
    <div className="screen">
      <div className="h1">{job.name}</div>
      {piles && (
        <div className="muted" style={{ marginBottom: 10 }}>
          {piles.length} piles · {counts.complete} complete · {counts.in_progress} in progress
          {counts.rejected ? ` · ${counts.rejected} rejected` : ''}
        </div>
      )}
      <input
        className="search"
        placeholder="Search pile #  (e.g. B-4)"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        inputMode="search"
      />
      {err && <ErrBox>Couldn't load piles: {err}</ErrBox>}
      {!piles && !err && <Loading />}
      <div className="pilegrid">
        {shown?.map((p) => (
          <button key={p.id} className={`pilecard s-${p.status}`} onClick={() => onPick(p)}>
            <div className="plabel">{p.label}</div>
            <div className="pstat">{STATUS_LABEL[p.status]}</div>
            <div className="pdesc">{p.description}</div>
          </button>
        ))}
      </div>
    </div>
  )
}
