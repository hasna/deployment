import { useEffect, useState } from 'react'
import { get } from '../api'

interface Blueprint {
  id: string
  name: string
  description?: string
  provider_type: string
  template: string
  created_at: string
}

export default function Blueprints() {
  const [blueprints, setBlueprints] = useState<Blueprint[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  useEffect(() => {
    get<Blueprint[]>('/blueprints')
      .then(setBlueprints)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="loading">Loading blueprints...</div>
  if (error) return <div className="error">{error}</div>

  if (blueprints.length === 0) {
    return <div className="empty">No blueprints available.</div>
  }

  return (
    <div className="section">
      <h2 className="section-title">Blueprints</h2>
      {blueprints.map((b) => (
        <div className="card" key={b.id}>
          <div className="card-header">
            <span className="card-title">
              <button className="link-btn" onClick={() => setExpanded(expanded === b.id ? null : b.id)}>
                {b.name}
              </button>
            </span>
            <span className="env-type">{b.provider_type}</span>
          </div>
          {b.description && <div className="card-meta">{b.description}</div>}
          <div className="blueprint-meta">
            <span>ID: {b.id}</span>
            <span>Created: {b.created_at}</span>
          </div>
          {expanded === b.id && (
            <pre style={{
              marginTop: 12,
              padding: 12,
              background: 'var(--bg)',
              border: '1px solid var(--border)',
              borderRadius: 4,
              fontSize: 12,
              overflow: 'auto',
              maxHeight: 300,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
            }}>
              {b.template}
            </pre>
          )}
        </div>
      ))}
    </div>
  )
}
