import { useEffect, useState } from 'react'
import { get } from '../api'
import StatusBadge from '../components/StatusBadge'

interface OverviewRow {
  project: string
  environment: string
  provider: string
  status: string
  url: string
  last_deploy: string
}

export default function Overview() {
  const [rows, setRows] = useState<OverviewRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    get<OverviewRow[]>('/overview')
      .then(setRows)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="loading">Loading overview...</div>
  if (error) return <div className="error">{error}</div>

  if (rows.length === 0) {
    return <div className="empty">No projects configured yet. Create a project and environment to get started.</div>
  }

  return (
    <div className="section">
      <h2 className="section-title">Deployment Overview</h2>
      <table>
        <thead>
          <tr>
            <th>Project</th>
            <th>Environment</th>
            <th>Provider</th>
            <th>Status</th>
            <th>URL</th>
            <th>Last Deploy</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td>{r.project}</td>
              <td>{r.environment}</td>
              <td>{r.provider}</td>
              <td><StatusBadge status={r.status} /></td>
              <td>{r.url ? <a href={r.url} target="_blank" rel="noreferrer">{r.url}</a> : <span className="card-meta">-</span>}</td>
              <td className="card-meta">{r.last_deploy}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
