import { useState } from 'react'
import Nav from './components/Nav'
import Overview from './pages/Overview'
import Projects from './pages/Projects'
import Providers from './pages/Providers'
import Blueprints from './pages/Blueprints'
import Deployments from './pages/Deployments'
import Doctor from './pages/Doctor'

const TABS = ['Overview', 'Projects', 'Providers', 'Blueprints', 'Deployments', 'Doctor'] as const
type Tab = (typeof TABS)[number]

export default function App() {
  const [tab, setTab] = useState<Tab>('Overview')

  return (
    <div className="app">
      <div className="header">
        <h1>open-deployment</h1>
        <span className="version">v0.0.1</span>
      </div>
      <Nav tabs={TABS as unknown as string[]} active={tab} onSelect={(t) => setTab(t as Tab)} />
      {tab === 'Overview' && <Overview />}
      {tab === 'Projects' && <Projects />}
      {tab === 'Providers' && <Providers />}
      {tab === 'Blueprints' && <Blueprints />}
      {tab === 'Deployments' && <Deployments />}
      {tab === 'Doctor' && <Doctor />}
    </div>
  )
}
