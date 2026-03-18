import { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import {
    Box, Typography, Tabs, Tab, Paper, Button, TextField, Select, MenuItem,
    FormControl, InputLabel, Switch, FormControlLabel, Chip, IconButton,
    Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
    CircularProgress, Alert, Tooltip
} from '@mui/material';
import SendIcon from '@mui/icons-material/Send';
import RefreshIcon from '@mui/icons-material/Refresh';
import InboxIcon from '@mui/icons-material/Inbox';
import OutboxIcon from '@mui/icons-material/Outbox';
import LockIcon from '@mui/icons-material/Lock';
import LockOpenIcon from '@mui/icons-material/LockOpen';
import { useSocket } from '../common/socket.jsx';
import {
    fetchMessages, fetchOutbox, sendMessage, fetchStats, fetchContacts
} from './bitlink21-slice.jsx';

const PAYLOAD_TYPES = [
    { value: 'text', label: 'Text', type: 0 },
    { value: 'bitcoin_tx', label: 'Bitcoin TX', type: 1 },
    { value: 'lightning', label: 'Lightning Invoice', type: 2 },
    { value: 'binary', label: 'Binary', type: 3 },
];

const StatusChip = ({ status }) => {
    const color = status === 'sent' ? 'success' : status === 'error' ? 'error' : 'warning';
    return <Chip label={status} color={color} size="small" />;
};

const StatsCards = ({ stats }) => {
    if (!stats) return null;
    return (
        <Box sx={{ display: 'flex', gap: 2, mb: 2, flexWrap: 'wrap' }}>
            <Paper sx={{ p: 2, flex: 1, minWidth: 120 }}>
                <Typography variant="caption" color="text.secondary">Received</Typography>
                <Typography variant="h5">{stats.total_received || 0}</Typography>
            </Paper>
            <Paper sx={{ p: 2, flex: 1, minWidth: 120 }}>
                <Typography variant="caption" color="text.secondary">Processed</Typography>
                <Typography variant="h5">{stats.total_processed || 0}</Typography>
            </Paper>
            <Paper sx={{ p: 2, flex: 1, minWidth: 120 }}>
                <Typography variant="caption" color="text.secondary">Errors</Typography>
                <Typography variant="h5" color="error">{stats.errors || 0}</Typography>
            </Paper>
            {stats.by_type && Object.entries(stats.by_type).map(([type, data]) => (
                <Paper key={type} sx={{ p: 2, flex: 1, minWidth: 120 }}>
                    <Typography variant="caption" color="text.secondary">{data.name || `Type ${type}`}</Typography>
                    <Typography variant="h5">{data.count || 0}</Typography>
                </Paper>
            ))}
        </Box>
    );
};

const MessageCompose = ({ socket, contacts }) => {
    const dispatch = useDispatch();
    const { sendLoading, sendError } = useSelector(state => state.bitlink21);
    const [recipient, setRecipient] = useState('');
    const [payloadType, setPayloadType] = useState('text');
    const [body, setBody] = useState('');
    const [encrypted, setEncrypted] = useState(true);
    const [broadcast, setBroadcast] = useState(false);

    const handleSend = async () => {
        if (!body.trim()) return;
        const typeInfo = PAYLOAD_TYPES.find(t => t.value === payloadType);
        await dispatch(sendMessage({
            socket,
            destination_npub: broadcast ? null : recipient || null,
            payload_type: typeInfo?.value || 'text',
            body: body.trim(),
            encrypted,
            broadcast,
        }));
        setBody('');
        dispatch(fetchOutbox({ socket }));
    };

    return (
        <Paper sx={{ p: 2, mb: 2 }}>
            <Typography variant="subtitle1" sx={{ mb: 2, fontWeight: 600 }}>Compose Message</Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <Box sx={{ display: 'flex', gap: 2 }}>
                    <FormControl size="small" sx={{ minWidth: 160 }}>
                        <InputLabel>Payload Type</InputLabel>
                        <Select value={payloadType} label="Payload Type" onChange={e => setPayloadType(e.target.value)}>
                            {PAYLOAD_TYPES.map(t => <MenuItem key={t.value} value={t.value}>{t.label}</MenuItem>)}
                        </Select>
                    </FormControl>
                    {!broadcast && (
                        <FormControl size="small" sx={{ flex: 1 }}>
                            <InputLabel>Recipient NPUB</InputLabel>
                            <Select
                                value={recipient}
                                label="Recipient NPUB"
                                onChange={e => setRecipient(e.target.value)}
                                displayEmpty
                            >
                                <MenuItem value=""><em>Manual entry or select contact</em></MenuItem>
                                {(contacts || []).map(c => (
                                    <MenuItem key={c.npub} value={c.npub}>
                                        {c.nickname ? `${c.nickname} (${c.npub.slice(0, 12)}...)` : `${c.npub.slice(0, 20)}...`}
                                    </MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                    )}
                </Box>
                {!broadcast && !contacts?.find(c => c.npub === recipient) && (
                    <TextField
                        size="small"
                        label="Recipient NPUB (manual)"
                        value={recipient}
                        onChange={e => setRecipient(e.target.value)}
                        placeholder="npub1..."
                    />
                )}
                <TextField
                    multiline
                    minRows={3}
                    maxRows={8}
                    label="Message Body"
                    value={body}
                    onChange={e => setBody(e.target.value)}
                    placeholder={payloadType === 'bitcoin_tx' ? 'Paste raw Bitcoin TX hex...' :
                        payloadType === 'lightning' ? 'Paste BOLT11 invoice...' : 'Type your message...'}
                />
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <FormControlLabel
                        control={<Switch checked={encrypted} onChange={e => setEncrypted(e.target.checked)} size="small" />}
                        label={<Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                            {encrypted ? <LockIcon fontSize="small" /> : <LockOpenIcon fontSize="small" />}
                            Encrypted
                        </Box>}
                    />
                    <FormControlLabel
                        control={<Switch checked={broadcast} onChange={e => setBroadcast(e.target.checked)} size="small" />}
                        label="Broadcast"
                    />
                    <Box sx={{ flex: 1 }} />
                    <Button
                        variant="contained"
                        endIcon={sendLoading ? <CircularProgress size={16} /> : <SendIcon />}
                        onClick={handleSend}
                        disabled={sendLoading || !body.trim()}
                    >
                        Send
                    </Button>
                </Box>
                {sendError && <Alert severity="error" sx={{ mt: 1 }}>{sendError}</Alert>}
            </Box>
        </Paper>
    );
};

const MessageList = ({ messages, loading, type = 'inbox' }) => {
    if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}><CircularProgress /></Box>;
    const items = type === 'outbox' ? (messages?.entries || []) : (messages || []);

    if (!items.length) {
        return (
            <Box sx={{ p: 4, textAlign: 'center' }}>
                <Typography color="text.secondary">No messages yet</Typography>
            </Box>
        );
    }

    return (
        <TableContainer>
            <Table size="small">
                <TableHead>
                    <TableRow>
                        <TableCell>Time</TableCell>
                        {type === 'inbox' && <TableCell>From</TableCell>}
                        {type === 'outbox' && <TableCell>To</TableCell>}
                        <TableCell>Type</TableCell>
                        <TableCell>Body</TableCell>
                        {type === 'inbox' && <TableCell>RSSI</TableCell>}
                        {type === 'inbox' && <TableCell>SNR</TableCell>}
                        {type === 'outbox' && <TableCell>Status</TableCell>}
                        <TableCell>Encrypted</TableCell>
                    </TableRow>
                </TableHead>
                <TableBody>
                    {items.map((msg, idx) => (
                        <TableRow key={msg.id || idx}>
                            <TableCell sx={{ whiteSpace: 'nowrap' }}>
                                {new Date(msg.timestamp).toLocaleString()}
                            </TableCell>
                            {type === 'inbox' && (
                                <TableCell>
                                    <Tooltip title={msg.sender_npub || 'Unknown'}>
                                        <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>
                                            {msg.sender_npub ? `${msg.sender_npub.slice(0, 12)}...` : '—'}
                                        </Typography>
                                    </Tooltip>
                                </TableCell>
                            )}
                            {type === 'outbox' && (
                                <TableCell>
                                    <Tooltip title={msg.destination_npub || 'Broadcast'}>
                                        <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>
                                            {msg.destination_npub ? `${msg.destination_npub.slice(0, 12)}...` : 'Broadcast'}
                                        </Typography>
                                    </Tooltip>
                                </TableCell>
                            )}
                            <TableCell>
                                <Chip
                                    label={PAYLOAD_TYPES.find(t => t.type === msg.payload_type)?.label || `Type ${msg.payload_type}`}
                                    size="small"
                                    variant="outlined"
                                />
                            </TableCell>
                            <TableCell sx={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {msg.body}
                            </TableCell>
                            {type === 'inbox' && <TableCell>{msg.rssi_db != null ? `${msg.rssi_db.toFixed(1)} dB` : '—'}</TableCell>}
                            {type === 'inbox' && <TableCell>{msg.snr_db != null ? `${msg.snr_db.toFixed(1)} dB` : '—'}</TableCell>}
                            {type === 'outbox' && <TableCell><StatusChip status={msg.status} /></TableCell>}
                            <TableCell>
                                {(msg.is_encrypted || msg.encrypted) ? <LockIcon fontSize="small" color="success" /> : <LockOpenIcon fontSize="small" color="disabled" />}
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </TableContainer>
    );
};

export default function MessagesPage() {
    const { t } = useTranslation('bitlink21');
    const dispatch = useDispatch();
    const {socket} = useSocket();
    const [tab, setTab] = useState(0);
    const { messages, messagesLoading, outbox, outboxLoading, stats, contacts } = useSelector(state => state.bitlink21);

    useEffect(() => {
        if (!socket) return;
        dispatch(fetchMessages({ socket }));
        dispatch(fetchOutbox({ socket }));
        dispatch(fetchStats({ socket }));
        dispatch(fetchContacts({ socket }));
    }, [socket, dispatch]);

    const handleRefresh = () => {
        if (!socket) return;
        if (tab === 0) dispatch(fetchMessages({ socket }));
        else dispatch(fetchOutbox({ socket }));
        dispatch(fetchStats({ socket }));
    };

    return (
        <Box sx={{ p: 3 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                <Typography variant="h5" sx={{ fontWeight: 600, flex: 1 }}>
                    {t('messages', 'Messages')}
                </Typography>
                {outbox?.pending_count > 0 && (
                    <Chip label={`${outbox.pending_count} pending`} color="warning" size="small" sx={{ mr: 2 }} />
                )}
                <IconButton onClick={handleRefresh} size="small">
                    <RefreshIcon />
                </IconButton>
            </Box>

            <StatsCards stats={stats} />
            <MessageCompose socket={socket} contacts={contacts} />

            <Paper>
                <Tabs value={tab} onChange={(_, v) => setTab(v)}>
                    <Tab icon={<InboxIcon />} iconPosition="start" label={`Inbox (${messages?.length || 0})`} />
                    <Tab icon={<OutboxIcon />} iconPosition="start" label={`Outbox (${outbox?.entries?.length || 0})`} />
                </Tabs>
                {tab === 0 && <MessageList messages={messages} loading={messagesLoading} type="inbox" />}
                {tab === 1 && <MessageList messages={outbox} loading={outboxLoading} type="outbox" />}
            </Paper>
        </Box>
    );
}
