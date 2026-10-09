import { useEffect, useMemo, useState } from 'react';
import {
    Badge, Box, Chip, CircularProgress, IconButton, Link, Paper, Stack, Tab, Tabs, Tooltip, Typography,
} from '@mui/material';
import ScheduleRoundedIcon from '@mui/icons-material/ScheduleRounded';
import DoneRoundedIcon from '@mui/icons-material/DoneRounded';
import DoneAllRoundedIcon from '@mui/icons-material/DoneAllRounded';
import ErrorOutlineRoundedIcon from '@mui/icons-material/ErrorOutlineRounded';
import HourglassBottomRoundedIcon from '@mui/icons-material/HourglassBottomRounded';
import LockRoundedIcon from '@mui/icons-material/LockRounded';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import InsertDriveFileOutlinedIcon from '@mui/icons-material/InsertDriveFileOutlined';
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded';
import CallReceivedRoundedIcon from '@mui/icons-material/CallReceivedRounded';
import CallMadeRoundedIcon from '@mui/icons-material/CallMadeRounded';
import { formatHz, parseInvoice, timeAgo } from './link-utils.js';

const TYPE_LABEL = { 1: 'Bitcoin TX', 2: 'Lightning', 3: 'Data' };
const NO_ECHO_AFTER_S = 60;

// Delivery track for something we sent
function DeliveryTrack({ msg }) {
    const [, tick] = useState(0);
    useEffect(() => {
        if (msg.status !== 'sent') return undefined;
        const t = setInterval(() => tick((n) => n + 1), 5000);
        return () => clearInterval(t);
    }, [msg.status]);

    if (msg.status === 'confirmed') {
        const off = msg.echo_offset_hz;
        return (
            <Chip
                size="small"
                icon={<DoneAllRoundedIcon />}
                label={`Echo received via QO-100${off !== null && off !== undefined ? ` · uplink ${formatHz(off)}` : ''}`}
                sx={{ bgcolor: 'success.dark', color: 'success.contrastText', fontWeight: 700, '& .MuiChip-icon': { color: 'inherit' } }}
            />
        );
    }
    if (msg.status === 'failed') {
        return <Chip size="small" icon={<ErrorOutlineRoundedIcon />} color="error" label={msg.error || 'Failed'} />;
    }
    const steps = { queued: 'Queued', sending: 'Transmitting…', sent: 'On air · waiting for the echo' };
    const icon = { queued: <ScheduleRoundedIcon />, sending: <CircularProgress size={14} color="inherit" />, sent: <DoneRoundedIcon /> }[msg.status];
    const late = msg.status === 'sent' && Date.now() / 1000 - msg.created_at > NO_ECHO_AFTER_S;
    return (
        <Tooltip title={late ? 'Your station has not decoded its own signal yet. Check the TX level and that the channel is free.' : ''}>
            <Chip
                size="small"
                icon={late ? <HourglassBottomRoundedIcon /> : icon}
                label={late ? 'Sent · no echo heard yet' : (steps[msg.status] || msg.status)}
                variant="outlined"
                sx={{ color: 'inherit', borderColor: 'currentColor', '& .MuiChip-icon': { color: 'inherit' } }}
            />
        </Tooltip>
    );
}

function MessageBody({ msg }) {
    if (msg.filename) {
        return (
            <Stack direction="row" spacing={1} alignItems="center">
                <InsertDriveFileOutlinedIcon />
                <Typography sx={{ fontWeight: 700 }}>{msg.filename}</Typography>
                <Typography variant="caption" sx={{ opacity: 0.85 }}>{((msg.size || 0) / 1024).toFixed(1)} kB</Typography>
            </Stack>
        );
    }
    if (msg.locked) {
        return (
            <Stack direction="row" spacing={1} alignItems="center" sx={{ opacity: 0.85 }}>
                <LockRoundedIcon fontSize="small" />
                <Typography variant="body2">Encrypted — set the matching passphrase to read it</Typography>
            </Stack>
        );
    }
    if (msg.payload_type === 1) {
        const txid = msg.relay_result?.txid;
        return (
            <Box>
                <Typography variant="body2" sx={{ fontFamily: 'monospace', wordBreak: 'break-all', opacity: 0.9 }}>
                    {msg.body_hex?.slice(0, 64)}{msg.body_hex?.length > 64 ? '…' : ''}
                </Typography>
                {txid && (
                    <Typography variant="caption" component="div">
                        Broadcast: <Link href={`https://mempool.space/tx/${txid}`} target="_blank" rel="noreferrer" color="inherit">{txid.slice(0, 16)}…</Link>
                    </Typography>
                )}
                {msg.direction === 'rx' && msg.relay_status === 'disabled' && (
                    <Typography variant="caption" component="div" sx={{ opacity: 0.8 }}>Relay is off (enable it under Bitcoin &amp; Lightning)</Typography>
                )}
                {msg.direction === 'rx' && msg.relay_status === 'error' && (
                    <Typography variant="caption" component="div" color="error.light">{msg.relay_result?.message}</Typography>
                )}
            </Box>
        );
    }
    if (msg.payload_type === 2) {
        const inv = parseInvoice(msg.body_text);
        return (
            <Stack direction="row" spacing={1} alignItems="center">
                <Typography variant="h6" sx={{ fontWeight: 700 }}>
                    ⚡ {inv?.sats !== null && inv?.sats !== undefined ? `${inv.sats.toLocaleString()} sats` : 'Any amount'}
                </Typography>
                <Typography variant="caption" sx={{ opacity: 0.8 }}>{inv?.network}</Typography>
                <Tooltip title="Copy invoice">
                    <IconButton size="small" onClick={() => navigator.clipboard?.writeText(msg.body_text)} sx={{ color: 'inherit' }}>
                        <ContentCopyRoundedIcon fontSize="small" />
                    </IconButton>
                </Tooltip>
            </Stack>
        );
    }
    return (
        <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {msg.body_text ?? msg.body_hex}
        </Typography>
    );
}

function Header({ out, who, when, chips, onDelete }) {
    return (
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5, px: 1 }}>
            {out ? <CallMadeRoundedIcon sx={{ fontSize: 16, color: 'primary.main' }} /> : <CallReceivedRoundedIcon sx={{ fontSize: 16, color: 'info.main' }} />}
            <Typography variant="caption" sx={{ fontWeight: 700 }}>{who}</Typography>
            <Typography variant="caption" color="text.secondary">{when}</Typography>
            {chips}
            {onDelete && (
                <IconButton className="bl21-del" size="small" onClick={onDelete} sx={{ opacity: 0, transition: 'opacity .15s' }}>
                    <DeleteOutlineRoundedIcon sx={{ fontSize: 16 }} />
                </IconButton>
            )}
        </Stack>
    );
}

function MessageItem({ msg, onDelete }) {
    const out = msg.direction === 'tx';
    const chips = (
        <>
            {msg.filename && <Chip size="small" label="File" sx={{ height: 18, fontSize: 11 }} />}
            {!msg.filename && TYPE_LABEL[msg.payload_type] && <Chip size="small" label={TYPE_LABEL[msg.payload_type]} sx={{ height: 18, fontSize: 11 }} />}
            {msg.encrypted && !msg.locked && <LockRoundedIcon sx={{ fontSize: 14, color: 'text.secondary' }} />}
        </>
    );
    return (
        <Stack alignItems={out ? 'flex-end' : 'flex-start'} sx={{ '&:hover .bl21-del': { opacity: 1 } }}>
            <Header
                out={out}
                who={out ? 'You → QO-100' : `${msg.callsign || 'Unknown station'} → you`}
                when={timeAgo(msg.created_at)}
                chips={chips}
                onDelete={() => onDelete(msg.id)}
            />
            <Paper
                elevation={0}
                sx={{
                    px: 2, py: 1.2, maxWidth: { xs: '92%', md: '78%' }, borderRadius: 3,
                    borderTopRightRadius: out ? 4 : 24, borderTopLeftRadius: out ? 24 : 4,
                    bgcolor: out ? 'primary.main' : 'action.hover',
                    color: out ? 'primary.contrastText' : 'text.primary',
                    borderLeft: out ? 0 : 3, borderColor: 'info.main',
                }}
            >
                <MessageBody msg={msg} />
                {out && <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 1 }}><DeliveryTrack msg={msg} /></Box>}
            </Paper>
        </Stack>
    );
}

function ReceivedFileItem({ file, onDownload }) {
    return (
        <Stack alignItems="flex-start">
            <Header out={false} who="Received file (off air)" when={timeAgo(file.created_at)} chips={<Chip size="small" label="File" sx={{ height: 18, fontSize: 11 }} />} />
            <Paper elevation={0} sx={{ px: 2, py: 1.2, maxWidth: { xs: '92%', md: '78%' }, borderRadius: 3, borderTopLeftRadius: 4, bgcolor: 'action.hover', borderLeft: 3, borderColor: 'info.main' }}>
                <Stack direction="row" spacing={1} alignItems="center">
                    <InsertDriveFileOutlinedIcon />
                    <Typography sx={{ fontWeight: 700 }}>{file.name}</Typography>
                    <Typography variant="caption" color="text.secondary">{(file.size / 1024).toFixed(1)} kB</Typography>
                    <Tooltip title="Download">
                        <IconButton size="small" onClick={() => onDownload(file)}><DownloadRoundedIcon fontSize="small" /></IconButton>
                    </Tooltip>
                </Stack>
            </Paper>
        </Stack>
    );
}

export default function LinkFeed({ messages, files, onDelete, onDownloadFile }) {
    const [tab, setTab] = useState('all');

    const items = useMemo(() => {
        const all = [
            ...messages.map((m) => ({ kind: 'msg', key: `m${m.id}`, t: m.created_at, m })),
            ...files.map((f) => ({ kind: 'file', key: `f${f.id}`, t: f.created_at, f })),
        ].sort((a, b) => b.t - a.t);
        return {
            all,
            received: all.filter((i) => i.kind === 'file' || i.m.direction === 'rx'),
            sent: all.filter((i) => i.kind === 'msg' && i.m.direction === 'tx'),
            files: all.filter((i) => i.kind === 'file' || i.m.filename),
        };
    }, [messages, files]);

    const echoes = items.sent.filter((i) => i.m.status === 'confirmed').length;
    const shown = items[tab];
    const empty = {
        all: 'No traffic yet. What you send and receive on this channel appears here.',
        received: 'Nothing received yet.',
        sent: 'Nothing sent yet.',
        files: 'No files yet. Files received off air (e.g. from the multimedia beacon) and files you send appear here.',
    }[tab];

    return (
        <Box>
            <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="scrollable" sx={{ minHeight: 36, mb: 2 }}>
                <Tab value="all" label={`All (${items.all.length})`} sx={{ minHeight: 36 }} />
                <Tab value="received" label={`Received (${items.received.length})`} sx={{ minHeight: 36 }} />
                <Tab
                    value="sent"
                    sx={{ minHeight: 36 }}
                    label={(
                        <Badge color="success" badgeContent={echoes ? `✓${echoes}` : 0} sx={{ '& .MuiBadge-badge': { right: -14 } }}>
                            {`Sent (${items.sent.length})`}
                        </Badge>
                    )}
                />
                <Tab value="files" label={`Files (${items.files.length})`} sx={{ minHeight: 36 }} />
            </Tabs>
            {shown.length === 0 ? (
                <Paper variant="outlined" sx={{ p: 4, borderRadius: 3, textAlign: 'center' }}>
                    <Typography color="text.secondary">{empty}</Typography>
                </Paper>
            ) : (
                <Stack spacing={2}>
                    {shown.map((i) => (i.kind === 'msg'
                        ? <MessageItem key={i.key} msg={i.m} onDelete={onDelete} />
                        : <ReceivedFileItem key={i.key} file={i.f} onDownload={onDownloadFile} />))}
                </Stack>
            )}
        </Box>
    );
}
