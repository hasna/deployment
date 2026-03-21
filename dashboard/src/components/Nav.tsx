interface NavProps {
  tabs: string[]
  active: string
  onSelect: (tab: string) => void
}

export default function Nav({ tabs, active, onSelect }: NavProps) {
  return (
    <div className="nav">
      {tabs.map((t) => (
        <button
          key={t}
          className={t === active ? 'active' : ''}
          onClick={() => onSelect(t)}
        >
          {t}
        </button>
      ))}
    </div>
  )
}
