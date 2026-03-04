import React, { useState, useEffect, useRef } from 'react'
import { api } from '../lib/api'

const IdentityPanel = ({ wsMetrics, onError, onSuccess }) => {
  const [npub, setNpub] = useState('')
  const [nsec, setNsec] = useState('')
  const [broadcastKey, setBroadcastKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [showAddressBook, setShowAddressBook] = useState(false)
  const [addressBook, setAddressBook] = useState([])
  const [newContact, setNewContact] = useState({ npub: '', nickname: '' })
  const [beaconMode, setBeaconMode] = useState('npub_only')

  useEffect(() => {
    console.debug('[IDENTITY] Component mounted, loading identity')
    // Load identity
    api.get('/api/v1/config/npub')
      .then(data => {
        console.debug('[IDENTITY] NPUB loaded', { npub: data?.npub ? data.npub.substring(0, 12) + '...' : 'empty' })
        setNpub(data?.npub || '')
      })
      .catch(err => {
        console.error('[IDENTITY] Failed to load NPUB', { error: err.message })
        onError?.('Failed to load NPUB')
      })

    api.get('/api/v1/config/broadcast_key')
      .then(data => {
        console.debug('[IDENTITY] Broadcast key loaded')
        setBroadcastKey(data?.broadcast_key || '')
      })
      .catch(err => {
        console.error('[IDENTITY] Failed to load broadcast key', { error: err.message })
        onError?.('Failed to load broadcast key')
      })

    // Load address book from API
    api.get('/api/v1/config/contacts')
      .then(data => {
        console.debug('[IDENTITY] Contacts loaded', { count: data?.contacts?.length || 0 })
        setAddressBook(data?.contacts || [])
      })
      .catch(err => {
        console.error('[IDENTITY] Failed to load contacts', { error: err.message })
        onError?.('Failed to load contacts')
      })

    // Load beacon TX mode from API
    api.get('/api/v1/config/beacon_tx_mode')
      .then(data => {
        console.debug('[IDENTITY] Beacon TX mode loaded', { mode: data?.beacon_tx_mode })
        setBeaconMode(data?.beacon_tx_mode || 'npub_only')
      })
      .catch(() => console.debug('[IDENTITY] Beacon TX mode not available'))
  }, [])

  const handleSaveIdentity = async () => {
    if (!npub.trim()) {
      console.debug('[IDENTITY] Save attempted with empty NPUB')
      onError?.('NPUB required')
      return
    }

    console.debug('[IDENTITY] Saving identity', { npub: npub.substring(0, 12) + '...', hasNsec: nsec.trim().length > 0 })
    setSaving(true)
    try {
      await api.post('/api/v1/config/npub', { value: npub })
      if (nsec.trim()) {
        console.debug('[IDENTITY] Saving NSEC')
        await api.post('/api/v1/config/nsec', { value: nsec })
      }
      console.debug('[IDENTITY] Identity saved successfully')
      onSuccess?.('Identity saved')
      setNsec('')
    } catch (error) {
      console.error('[IDENTITY] Save error', { error: error.message })
      onError?.('Failed to save identity: ' + error.message)
    } finally {
      setSaving(false)
    }
  }

  const handleSaveBroadcastKey = async () => {
    console.debug('[IDENTITY] Saving broadcast key')
    setSaving(true)
    try {
      await api.post('/api/v1/config/broadcast_key', { value: broadcastKey })
      console.debug('[IDENTITY] Broadcast key saved')
      alert('Broadcast key saved')
    } catch (error) {
      console.error('[IDENTITY] Broadcast key save error', { error: error.message })
      alert('Failed to save: ' + error.message)
    } finally {
      setSaving(false)
    }
  }

  const handleAddContact = async () => {
    if (!newContact.npub.trim()) {
      console.debug('[IDENTITY] Add contact attempted with empty NPUB')
      return
    }
    console.debug('[IDENTITY] Adding contact', { nickname: newContact.nickname, npub: newContact.npub.substring(0, 12) + '...' })
    try {
      await api.post('/api/v1/config/contacts', newContact)
      // Reload address book after adding
      const res = await api.get('/api/v1/config/contacts')
      console.debug('[IDENTITY] Contacts reloaded after add', { count: res?.contacts?.length || 0 })
      setAddressBook(res?.contacts || [])
      setNewContact({ npub: '', nickname: '' })
    } catch (err) {
      console.error('[IDENTITY] Failed to add contact', { error: err.message })
    }
  }

  const handleRemoveContact = async (contact) => {
    console.debug('[IDENTITY] Removing contact', { nickname: contact.nickname, npub: contact.npub.substring(0, 12) + '...' })
    try {
      await api.delete(`/api/v1/config/contacts/${contact.npub}`)
      // Filter by npub, not by non-existent id field
      setAddressBook(prev => prev.filter(c => c.npub !== contact.npub))
      console.debug('[IDENTITY] Contact removed')
    } catch (err) {
      console.error('[IDENTITY] Failed to remove contact', { error: err.message })
    }
  }

  const copyToClipboard = (text) => {
    console.debug('[IDENTITY] Copied to clipboard', { length: text.length })
    navigator.clipboard.writeText(text)
  }

  return (
    <div className="space-y-4 text-sm">
      {/* NPUB Display (Large) */}
      {npub && (
        <div className="bg-slate-800 p-3 rounded border border-slate-700">
          <div className="text-xs text-slate-400 mb-2">Your NPUB</div>
          <div className="font-mono text-xs text-cyan-400 break-all mb-2">{npub}</div>
          <button
            onClick={() => copyToClipboard(npub)}
            className="w-full px-2 py-1 bg-slate-700 hover:bg-slate-600 text-xs text-slate-200 rounded"
          >
            📋 Copy
          </button>
        </div>
      )}

      {/* NPUB Input */}
      <div>
        <label className="block text-xs font-semibold text-slate-400 mb-2">NPUB (Public)</label>
        <input
          type="text"
          value={npub}
          onChange={(e) => setNpub(e.target.value)}
          placeholder="64-char hex"
          className="w-full px-2 py-1 bg-slate-800 border border-slate-600 rounded text-xs text-slate-100 font-mono"
        />
      </div>

      {/* NSEC */}
      <div>
        <label className="block text-xs font-semibold text-slate-400 mb-2">NSEC (Private - write only)</label>
        <input
          type="password"
          value={nsec}
          onChange={(e) => setNsec(e.target.value)}
          placeholder="64-char hex (only on set)"
          className="w-full px-2 py-1 bg-slate-800 border border-slate-600 rounded text-xs text-slate-100 font-mono"
        />
      </div>

      <button
        onClick={handleSaveIdentity}
        disabled={saving}
        className="w-full px-2 py-1 bg-green-700 hover:bg-green-800 disabled:bg-slate-700 text-white text-xs font-semibold rounded"
      >
        {saving ? 'Saving...' : 'Save Identity'}
      </button>

      {/* Beacon TX Config */}
      <div className="border-t border-slate-700 pt-4">
        <label className="block text-xs font-semibold text-slate-400 mb-2">Beacon TX Config</label>
        <select
          value={beaconMode}
          onChange={async (e) => {
            setBeaconMode(e.target.value)
            try { await api.post('/api/v1/config/beacon_tx_mode', { value: e.target.value }) }
            catch (err) { console.error('Beacon TX mode error:', err) }
          }}
          className="w-full px-2 py-1 bg-slate-800 border border-slate-600 rounded text-xs text-slate-100"
        >
          <option value="npub_only">NPUB only</option>
          <option value="npub_nickname">NPUB + Nickname</option>
          <option value="off">Off</option>
        </select>
      </div>

      {/* Broadcast Key */}
      <div className="border-t border-slate-700 pt-4">
        <label className="block text-xs font-semibold text-slate-400 mb-2">Broadcast Key</label>
        <input
          type="text"
          value={broadcastKey}
          onChange={(e) => setBroadcastKey(e.target.value)}
          placeholder="Shared passphrase"
          className="w-full px-2 py-1 bg-slate-800 border border-slate-600 rounded text-xs text-slate-100"
        />
        <button
          onClick={handleSaveBroadcastKey}
          disabled={saving}
          className="w-full mt-2 px-2 py-1 bg-blue-700 hover:bg-blue-800 disabled:bg-slate-700 text-white text-xs font-semibold rounded"
        >
          {saving ? 'Saving...' : 'Save Key'}
        </button>
      </div>

      {/* Address Book */}
      <div className="border-t border-slate-700 pt-4">
        <div className="flex justify-between items-center mb-2">
          <label className="text-xs font-semibold text-slate-400">Address Book</label>
          <button
            onClick={() => setShowAddressBook(!showAddressBook)}
            className="text-xs text-cyan-400 hover:text-cyan-300"
          >
            {showAddressBook ? '▼' : '▶'} {addressBook.length}
          </button>
        </div>

        {showAddressBook && (
          <div className="space-y-2 mb-3">
            {addressBook.map(contact => (
              <div key={contact.npub} className="text-xs bg-slate-800 p-2 rounded border border-slate-700 flex justify-between items-start">
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-slate-300">{contact.nickname}</div>
                  <div className="font-mono text-slate-500 truncate text-xs">{contact.npub}</div>
                </div>
                <button
                  onClick={() => handleRemoveContact(contact)}
                  className="ml-2 text-slate-500 hover:text-red-400 flex-shrink-0"
                >
                  ✕
                </button>
              </div>
            ))}

            {/* Add Contact */}
            <div className="space-y-1 border-t border-slate-700 pt-2">
              <input
                type="text"
                value={newContact.nickname}
                onChange={(e) => setNewContact({ ...newContact, nickname: e.target.value })}
                placeholder="Nickname"
                className="w-full px-2 py-1 bg-slate-800 border border-slate-600 rounded text-xs text-slate-100"
              />
              <input
                type="text"
                value={newContact.npub}
                onChange={(e) => setNewContact({ ...newContact, npub: e.target.value })}
                placeholder="NPUB"
                className="w-full px-2 py-1 bg-slate-800 border border-slate-600 rounded text-xs text-slate-100 font-mono"
              />
              <button
                onClick={handleAddContact}
                className="w-full px-2 py-1 bg-cyan-700 hover:bg-cyan-600 text-white text-xs font-semibold rounded"
              >
                Add
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default IdentityPanel
