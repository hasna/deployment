import { useEffect, useState } from 'react'
import { get } from '../api'
import StatusBadge from '../components/StatusBadge'

interface Project {
  id: string
  name: string
  source_type: string
  source_url: string
  description?: string
  created_at: string
}

interface Environment {
  id: string
  project_id: string
  name: string
  type: string
  provider_id: string
  region?: string
  created_at: string
}

interface Deployment {
  id: string
  project_id: string
  environment_id: string
  status: string
  url?: string
  version?: string
  commit_sha?: string
  created_at: string
}

export default function Projects() {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [envs, setEnvs] = useState<Environment[]>([])
  const [deployments, setDeployments] = useState<Deployment[]>([])

  useEffect(() => {
    get<Project[]>('/projects')
      .then(setProjects)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  const selectProject = (id: string) => {
    setSelected(id)
    get<Environment[]>(`/projects/${id}/environments`).then(setEnvs).catch(() => setEnvs([]))
    get<Deployment[]>(`/deployments?project_id=${id}&limit=10`).then(setDeployments).catch(() => setDeployments([]))
  }

  if (loading) return <div className="loading">Loading projects...</div>
  if (error) return <div className="error">{error}</div>

  if (selected) {
    const proj = projects.find((p) => p.id === selected)
    return (
      <div className="section">
        <button className="detail-back" onClick={() => setSelected(null)}>
          &larr; Back to projects
        </button>
        <h2 className="section-title">{proj?.name ?? selected}</h2>
        {proj && (
          <div className="card" style={{ marginBottom: 20 }}>
            <div className="card-meta">
              Source: {proj.source_type} {proj.source_url ? `- ${proj.source_url}` : ''}
            </div>
            {proj.description && <div className="card-meta" style={{ marginTop: 4 }}>{proj.description}</div>}
          </div>
        )}

        <h3 className="section-title">Environments</h3>
        {envs.length === 0 ? (
          <div className="empty">No environments configured.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Provider ID</th>
                <th>Region</th>
              </tr>
            </thead>
            <tbody>
              {envs.map((e) => (
                <tr key={e.id}>
                  <td>{e.name}</td>
                  <td><span className="env-type">{e.type}</span></td>
                  <td className="card-meta">{e.provider_id}</td>
                  <td className="card-meta">{e.region ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <h3 className="section-title">Recent Deployments</h3>
        {deployments.length === 0 ? (
          <div className="empty">No deployments yet.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Environment</th>
                <th>Status</th>
                <th>Version</th>
                <th>URL</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {deployments.map((d) => (
                <tr key={d.id}>
                  <td className="card-meta">{d.id.slice(0, 8)}</td>
                  <td className="card-meta">{d.environment_id.slice(0, 8)}</td>
                  <td><StatusBadge status={d.status} /></td>
                  <td className="card-meta">{d.version ?? '-'}</td>
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

  if (projects.length === 0) {
    return <div className="empty">No projects found. Use the CLI or API to create one.</div>
  }

  return (
    <div className="section">
      <h2 className="section-title">Projects</h2>
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Source</th>
            <th>Description</th>
            <th>Created</th>
          </tr>
        </thead>
        <tbody>
          {projects.map((p) => (
            <tr key={p.id}>
              <td>
                <button className="link-btn" onClick={() => selectProject(p.id)}>
                  {p.name}
                </button>
              </td>
              <td className="card-meta">{p.source_type}{p.source_url ? ` - ${p.source_url}` : ''}</td>
              <td className="card-meta">{p.description ?? '-'}</td>
              <td className="card-meta">{p.created_at}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
