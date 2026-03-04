import React from 'react'

const TABS = [
  { id: 'radio', label: 'RADIO', shortcut: 'F1' },
  { id: 'messages', label: 'MESSAGES', shortcut: 'F2' },
  { id: 'files', label: 'FILES', shortcut: 'F3' },
  { id: 'identity', label: 'IDENTITY', shortcut: 'F4' },
  { id: 'settings', label: 'SETTINGS', shortcut: 'F5' },
  { id: 'debug', label: 'DEBUG', shortcut: 'F6' },
]

const TabBar = ({ activeTab, onTabChange, unreadMessages = 0 }) => {
  return (
    <div className="flex-shrink-0 bg-slate-900 border-b border-slate-700 flex">
      {TABS.map(tab => (
        <button
          key={tab.id}
          onClick={() => onTabChange(tab.id)}
          className={`px-4 py-2 text-xs font-bold tracking-wider transition-all border-b-2 relative ${
            activeTab === tab.id
              ? 'text-cyan-400 border-cyan-400 bg-slate-800'
              : 'text-slate-500 border-transparent hover:text-slate-300 hover:bg-slate-800/50'
          }`}
          title={tab.shortcut}
        >
          {tab.label}
          {tab.id === 'messages' && unreadMessages > 0 && (
            <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center" style={{ fontSize: '9px' }}>
              {unreadMessages > 9 ? '9+' : unreadMessages}
            </span>
          )}
        </button>
      ))}
    </div>
  )
}

export { TABS }
export default TabBar
