import { useEffect, useState } from 'react'
import { get } from '../api'
import StatusBadge from '../components/StatusBadge'

export default function Doctor() {
  const [checks, setChecks] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    get<Record<string, string>>('/doctor')
      .then(setChecks)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="loading">Running health checks...</div>
  if (error) return <div className="error">{error}</div>

  const entries = Object.entries(checks)
  if (entries.length === 0) {
    return <div className="empty">No health checks returned.</div>
  }

  return (
    <div className="section">
      <h2 className="section-title">System Health</h2>
      <div className="doctor-grid">
        {entries.map(([name, status]) => (
          <div className="doctor-item" key={name}>
            <span className="label">{name.replace(/_/g, ' ')}</span>
            <StatusBadge status={status} />
          </div>
        ))}
      </div>
    </div>
  )
}
