import { useEffect, useState, useCallback } from 'react'
import { get } from '../api'
import StatusBadge from '../components/StatusBadge'

interface Deployment {
  id: string
  project_id: string
  environment_id: string
  status: string
  url?: string
  version?: string
  commit_sha?: string
  image?: string
  created_at: string
}

const STATUS_OPTIONS = ['all', 'pending', 'building', 'deploying', 'live', 'failed', 'rolled_back'] as const

export default function Deployments() {
  const [deployments, setDeployments] = useState<Deployment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')

  const load = useCallback(() => {
    setLoading(true)
    const params = new URLSearchParams()
    if (statusFilter !== 'all') params.set('status', statusFilter)
    params.set('limit', '50')
    get<Deployment[]>(`/deployments?${params}`)
      .then(setDeployments)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [statusFilter])

  useEffect(() => { load() }, [load])

  return (
    <div className="section">
      <h2 className="section-title">Deployments</h2>
      <div className="filters">
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>{s === 'all' ? 'All statuses' : s}</option>
          ))}
        </select>
      </div>

      {loading && <div className="loading">Loading deployments...</div>}
      {error && <div className="error">{error}</div>}

      {!loading && !error && deployments.length === 0 && (
        <div className="empty">No deployments found{statusFilter !== 'all' ? ` with status "${statusFilter}"` : ''}.</div>
      )}

      {!loading && !error && deployments.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Project</th>
              <th>Environment</th>
              <th>Status</th>
              <th>Version</th>
              <th>Commit</th>
              <th>URL</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {deployments.map((d) => (
              <tr key={d.id}>
                <td className="card-meta">{d.id.slice(0, 8)}</td>
                <td className="card-meta">{d.project_id.slice(0, 8)}</td>
                <td className="card-meta">{d.environment_id.slice(0, 8)}</td>
                <td><StatusBadge status={d.status} /></td>
                <td className="card-meta">{d.version ?? '-'}</td>
                <td className="card-meta">{d.commit_sha ? d.commit_sha.slice(0, 7) : '-'}</td>
                <td>{d.url ? <a href={d.url} target="_blank" rel="noreferrer">{d.url}</a> : '-'}</td>
                <td className="card-meta">{d.created_at}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
