import React, { useEffect, useState } from 'react'
import { getJobs } from '../lib/db.js'
import { Loading, ErrBox } from '../components/ui.jsx'

const TYPE_LABEL = { pile_driving: 'Pile Driving', drilled_shafts: 'Drilled Shafts' }

export default function JobPicker({ onPick }) {
  const [jobs, setJobs] = useState(null)
  const [err, setErr] = useState(null)

  useEffect(() => {
    getJobs().then(setJobs).catch((e) => setErr(e.message))
  }, [])

  return (
    <div className="screen">
      <div className="h1">Select job</div>
      {err && <ErrBox>Couldn't load jobs: {err}</ErrBox>}
      {!jobs && !err && <Loading />}
      {jobs?.map((job) => (
        <button key={job.id} className="card jobcard" style={{ width: '100%' }} onClick={() => onPick(job)}>
          <div className="jobname">{job.name}</div>
          <div className="jobmeta">
            {job.job_number} · {job.location}
          </div>
          <span className="jobtype">{TYPE_LABEL[job.job_type] ?? job.job_type}</span>
        </button>
      ))}
    </div>
  )
}
