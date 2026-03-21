import { useEffect, useState } from 'react'
import { get } from '../api'

interface Provider {
  id: string
  name: string
  type: string
  credentials_key: string
  created_at: string
}

export default function Providers() {
  const [providers, setProviders] = useState<Provider[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    get<Provider[]>('/providers')
      .then(setProviders)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="loading">Loading providers...</div>
  if (error) return <div className="error">{error}</div>

  if (providers.length === 0) {
    return <div className="empty">No providers configured. Use the CLI or API to register a provider.</div>
  }

  return (
    <div className="section">
      <h2 className="section-title">Providers</h2>
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Type</th>
            <th>Credentials Key</th>
            <th>Created</th>
          </tr>
        </thead>
        <tbody>
          {providers.map((p) => (
            <tr key={p.id}>
              <td>{p.name}</td>
              <td><span className="env-type">{p.type}</span></td>
              <td className="card-meta">{p.credentials_key || '-'}</td>
              <td className="card-meta">{p.created_at}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
