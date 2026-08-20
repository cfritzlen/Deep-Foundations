import React, { useState } from 'react'
import { hasKey } from './lib/db.js'
import { COMPANY } from './lib/config.js'
import JobPicker from './screens/JobPicker.jsx'
import PileList from './screens/PileList.jsx'
import ShaftLog from './screens/ShaftLog.jsx'
import DriveLog from './screens/DriveLog.jsx'
import ExportLog from './screens/ExportLog.jsx'
import ObstructionLog from './screens/ObstructionLog.jsx'

export default function App() {
  const [view, setView] = useState({ name: 'jobs' })

  if (!hasKey) {
    return (
      <div className="shell">
        <TopBar />
        <div className="screen">
          <div className="card">
            <div className="h1">Almost ready</div>
            <p className="muted">
              The database connection key hasn't been added yet. Paste the Supabase
              publishable key into <code>src/lib/config.js</code> and reload.
            </p>
          </div>
        </div>
      </div>
    )
  }

  const back = () => {
    if (view.name === 'piles') setView({ name: 'jobs' })
    else if (view.name === 'obstructions') setView({ name: 'piles', job: view.job })
    else if (view.name === 'log') setView({ name: 'piles', job: view.job })
    else if (view.name === 'export') setView({ name: 'log', job: view.job, pile: view.pile })
  }

  return (
    <div className="shell">
      <TopBar view={view} onBack={view.name !== 'jobs' ? back : null} />
      {view.name === 'jobs' && <JobPicker onPick={(job) => setView({ name: 'piles', job })} />}
      {view.name === 'piles' && (
        <PileList job={view.job}
          onPick={(pile) => setView({ name: 'log', job: view.job, pile })}
          onObstructions={() => setView({ name: 'obstructions', job: view.job })} />
      )}
      {view.name === 'obstructions' && <ObstructionLog job={view.job} />}
      {view.name === 'log' &&
        (view.pile.pile_kind === 'shaft' ? (
          <ShaftLog
            key={view.pile.id}
            pile={view.pile}
            job={view.job}
            onExport={() => setView({ ...view, name: 'export' })}
            onExit={back}
          />
        ) : (
          <DriveLog
            key={view.pile.id}
            pile={view.pile}
            job={view.job}
            onExport={() => setView({ ...view, name: 'export' })}
            onExit={back}
          />
        ))}
      {view.name === 'export' && <ExportLog pile={view.pile} job={view.job} />}
    </div>
  )
}

function TopBar({ view, onBack }) {
  return (
    <div className="topbar">
      {onBack && (
        <button className="backbtn" onClick={onBack} aria-label="Back">‹</button>
      )}
      <img src="/bedrock-logo.png" alt="" />
      <div className="brand">
        <b>{COMPANY.name}</b>
        <span>{COMPANY.tagline}</span>
      </div>
      {view?.job && (
        <div className="ctx">
          {view.job.job_number}
          {view.pile && (
            <>
              <br />
              <b>{view.pile.label}</b>
            </>
          )}
        </div>
      )}
    </div>
  )
}
