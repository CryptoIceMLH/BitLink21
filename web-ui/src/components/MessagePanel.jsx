import React, { useState, useEffect } from 'react'
import { api } from '../lib/api'
import { useWebSocket } from '../lib/websocket'

const MessagePanel = ({ wsMetrics, onError, onSuccess }) => {
  const [messages, setMessages] = useState([])
  const [sentMessages, setSentMessages] = useState([])
  const [outboxMessages, setOutboxMessages] = useState([])
  const [compose, setCompose] = useState('')
  const [recipientNpub, setRecipientNpub] = useState('')
  const [payloadType, setPayloadType] = useState('text')
  const [sending, setSending] = useState(false)
  const [activeTab, setActiveTab] = useState('inbox')
  const [unreadCount, setUnreadCount] = useState(0)
  const [encrypted, setEncrypted] = useState(true)
  const [doublePass, setDoublePass] = useState(true)
  const [expandedMsgId, setExpandedMsgId] = useState(null)
  const ws = useWebSocket()

  useEffect(() => {
    console.debug('[MESSAGES] Component mounted, loading messages')
    api.get('/api/v1/messages').then(data => {
      console.debug('[MESSAGES] Inbox loaded', { count: data?.messages?.length || 0 })
      setMessages(data?.messages || [])
    }).catch(err => {
      console.error('[MESSAGES] Failed to load inbox', { error: err.message })
      onError?.('Failed to load messages')
    })

    api.get('/api/v1/queue').then(data => {
      console.debug('[MESSAGES] Queue loaded', { count: data?.messages?.length || 0 })
      setOutboxMessages(data?.messages || [])
    }).catch(err => {
      console.error('[MESSAGES] Failed to load queue', { error: err.message })
      onError?.('Failed to load message queue')
    })

    if (!ws) {
      console.debug('[MESSAGES] WS not ready, skipping rx_frame listener')
      return
    }

    console.debug('[MESSAGES] Setting up rx_frame listener')
    const handleMessage = (event) => {
      try {
        const msg = JSON.parse(event.data)
        if (msg.type === 'rx_frame') {
          console.debug('[MESSAGES] rx_frame received', {
            sender: msg.sender_npub ? msg.sender_npub.substring(0, 12) + '...' : 'BROADCAST',
            rssi_db: msg.rssi_at_rx_db,
            snr_db: msg.snr_at_rx_db,
            encrypted: !msg.sender_npub
          })
          const newMsg = {
            id: msg.msg_id,
            timestamp: new Date().toISOString(),
            sender_npub: msg.sender_npub,
            body: msg.body || `[message]`,
            rssi_db: msg.rssi_at_rx_db,
            snr_db: msg.snr_at_rx_db,
            is_encrypted: !msg.sender_npub,
            isRead: false,
          }
          setMessages(prev => [newMsg, ...prev])
          setUnreadCount(prev => prev + 1)
        }
      } catch (e) {
        console.error('[MESSAGES] Error parsing rx_frame', { error: e.message })
      }
    }

    ws.addEventListener('message', handleMessage)
    return () => {
      console.debug('[MESSAGES] Removing rx_frame listener')
      ws.removeEventListener('message', handleMessage)
    }
  }, [ws])

  const handleSend = async () => {
    if (!compose.trim()) {
      console.debug('[MESSAGES] Send attempted with empty compose')
      return
    }

    console.debug('[MESSAGES] Sending message', {
      destination: recipientNpub ? recipientNpub.substring(0, 12) + '...' : 'BROADCAST',
      payloadType,
      length: compose.length,
      encrypted,
      doublePass
    })
    setSending(true)
    try {
      const payloadTypeMap = { text: 0, bitcoin: 1, lightning: 2, binary: 3 }
      const sent_msg = {
        id: Date.now(),
        timestamp: new Date().toISOString(),
        destination_npub: recipientNpub || 'broadcast',
        payload_type: payloadTypeMap[payloadType],
        body: compose,
        isRead: true,
      }

      await api.post('/api/v1/send', {
        destination_npub: recipientNpub || null,
        payload_type: payloadTypeMap[payloadType],
        body: compose,
        encrypted: encrypted,
        double_pass: doublePass,
      })

      console.debug('[MESSAGES] Message sent successfully', { msgId: sent_msg.id })
      setSentMessages(prev => [sent_msg, ...prev])
      setCompose('')
      setRecipientNpub('')
      onSuccess?.('Message sent')
    } catch (error) {
      console.error('[MESSAGES] Send error', { error: error.message })
      onError?.('Failed to send message: ' + (error.message || 'Unknown error'))
    } finally {
      setSending(false)
    }
  }

  const displayMessages =
    activeTab === 'inbox' ? messages :
    activeTab === 'outbox' ? outboxMessages :
    sentMessages

  return (
    <div className="h-full flex flex-col gap-2 text-xs overflow-hidden">
      {/* Tabs */}
      <div className="flex gap-2 flex-shrink-0 border-b border-slate-700 pb-2">
        <button
          onClick={() => { setActiveTab('inbox'); setUnreadCount(0) }}
          className={`px-2 py-1 text-xs font-bold transition ${
            activeTab === 'inbox'
              ? 'text-cyan-400 border-b-2 border-cyan-400'
              : 'text-slate-400 hover:text-slate-300'
          }`}
        >
          INBOX {unreadCount > 0 && `(${unreadCount})`}
        </button>
        <button
          onClick={() => setActiveTab('outbox')}
          className={`px-2 py-1 text-xs font-bold transition ${
            activeTab === 'outbox'
              ? 'text-cyan-400 border-b-2 border-cyan-400'
              : 'text-slate-400 hover:text-slate-300'
          }`}
        >
          OUTBOX
        </button>
        <button
          onClick={() => setActiveTab('sent')}
          className={`px-2 py-1 text-xs font-bold transition ${
            activeTab === 'sent'
              ? 'text-cyan-400 border-b-2 border-cyan-400'
              : 'text-slate-400 hover:text-slate-300'
          }`}
        >
          SENT
        </button>
      </div>

      {/* Messages List */}
      <div className="flex-1 overflow-y-auto space-y-1">
        {displayMessages.length === 0 ? (
          <div className="text-slate-500 italic">{activeTab === 'inbox' ? 'No messages' : 'Empty'}</div>
        ) : (
          displayMessages.map(msg => (
            <div key={msg.id}>
              <button
                onClick={() => setExpandedMsgId(expandedMsgId === msg.id ? null : msg.id)}
                className={`w-full text-left p-1 rounded border transition ${
                  expandedMsgId === msg.id
                    ? 'bg-slate-700 border-cyan-500'
                    : msg.isRead ? 'bg-slate-800 border-slate-700 hover:border-slate-600' : 'bg-slate-700 border-cyan-700'
                }`}
              >
                <div className="flex gap-1 items-start justify-between">
                  <span>{msg.is_encrypted ? '🔒' : '📨'}</span>
                  <span className="flex-1 font-mono text-slate-400 truncate text-xs">
                    {msg.sender_npub ? msg.sender_npub.substring(0, 12) + '...' : 'BROADCAST'}
                  </span>
                  <span className="text-slate-500 text-xs">{msg.payload_type || 'TEXT'}</span>
                  <span className="text-slate-500 text-xs">{new Date(msg.timestamp).toLocaleTimeString()}</span>
                </div>
                <div className="text-slate-300 truncate text-xs mt-0.5">{msg.body.substring(0, 50)}</div>
              </button>

              {/* Expanded view */}
              {expandedMsgId === msg.id && (
                <div className="bg-slate-800 border border-slate-600 rounded p-2 mt-1 text-xs">
                  <div className="font-mono text-slate-400 mb-1">
                    {msg.sender_npub ? `From: ${msg.sender_npub}` : 'Broadcast'}
                  </div>
                  <div className="text-slate-200 break-words mb-2 bg-slate-900 p-1 rounded">
                    {msg.body}
                  </div>
                  {msg.rssi_db && (
                    <div className="text-slate-500 text-xs">
                      RSSI: {msg.rssi_db.toFixed(1)} dBm | SNR: {msg.snr_db?.toFixed(1) || 'N/A'} dB
                    </div>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Compose (only in inbox/outbox) */}
      {(activeTab === 'inbox' || activeTab === 'outbox') && (
        <div className="flex-shrink-0 border-t border-slate-700 pt-2 space-y-1">
          <div className="text-slate-400 font-bold">COMPOSE</div>

          <input
            type="text"
            value={recipientNpub}
            onChange={(e) => setRecipientNpub(e.target.value)}
            placeholder="To NPUB (empty=broadcast)"
            className="w-full px-1 py-0.5 bg-slate-800 border border-slate-600 rounded text-xs text-slate-100"
          />

          <div className="flex gap-2">
            <select
              value={payloadType}
              onChange={(e) => setPayloadType(e.target.value)}
              className="flex-1 px-1 py-0.5 bg-slate-800 border border-slate-600 rounded text-xs text-slate-100"
            >
              <option value="text">Text</option>
              <option value="bitcoin">Bitcoin TX</option>
              <option value="lightning">Lightning</option>
              <option value="binary">Binary</option>
            </select>

            <label className="flex items-center gap-1 text-slate-400">
              <input
                type="checkbox"
                checked={encrypted}
                onChange={(e) => setEncrypted(e.target.checked)}
                className="w-3 h-3"
              />
              <span className="text-xs">Lock</span>
            </label>

            <label className="flex items-center gap-1 text-slate-400">
              <input
                type="checkbox"
                checked={doublePass}
                onChange={(e) => setDoublePass(e.target.checked)}
                className="w-3 h-3"
              />
              <span className="text-xs">2x</span>
            </label>
          </div>

          {!encrypted && <div className="text-red-400 text-xs font-bold">UNENCRYPTED</div>}

          <textarea
            value={compose}
            onChange={(e) => setCompose(e.target.value.substring(0, 204))}
            placeholder="Message (max 204 bytes)"
            className="w-full h-12 px-1 py-0.5 bg-slate-800 border border-slate-600 rounded text-xs text-slate-100 resize-none"
          />

          <div className="text-slate-500 text-xs">{compose.length}/204</div>

          <button
            onClick={handleSend}
            disabled={!compose.trim() || sending}
            className="w-full px-2 py-1 bg-cyan-600 hover:bg-cyan-700 disabled:bg-slate-700 disabled:text-slate-500 text-white text-xs font-bold rounded transition"
          >
            {sending ? 'SENDING...' : 'SEND'}
          </button>
        </div>
      )}
    </div>
  )
}

export default MessagePanel
