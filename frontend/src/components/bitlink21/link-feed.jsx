import {
    Box, Chip, CircularProgress, IconButton, Link, Paper, Stack, Tooltip, Typography,
} from '@mui/material';
import ScheduleRoundedIcon from '@mui/icons-material/ScheduleRounded';
import DoneRoundedIcon from '@mui/icons-material/DoneRounded';
import DoneAllRoundedIcon from '@mui/icons-material/DoneAllRounded';
import ErrorOutlineRoundedIcon from '@mui/icons-material/ErrorOutlineRounded';
import LockRoundedIcon from '@mui/icons-material/LockRounded';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import InsertDriveFileOutlinedIcon from '@mui/icons-material/InsertDriveFileOutlined';
import { formatHz, parseInvoice, timeAgo } from './link-utils.js';

const TYPE_LABEL = { 0: null, 1: 'Bitcoin TX', 2: 'Lightning', 3: 'Data' };

function TxState({ msg }) {
    const map = {
        queued: [<ScheduleRoundedIcon fontSize="inherit" key="i" />, 'Queued'],
        sending: [<CircularProgress size={12} color="inherit" key="i" />, 'Transmitting…'],
        sent: [<DoneRoundedIcon fontSize="inherit" key="i" />, 'Sent, waiting to hear it back'],
        confirmed: [<DoneAllRoundedIcon fontSize="inherit" key="i" />, 'Heard back via the satellite'],
        failed: [<ErrorOutlineRoundedIcon fontSize="inherit" key="i" />, msg.error || 'Failed'],
    }[msg.status] || [null, msg.status];
    const extra = msg.status === 'confirmed' && msg.echo_offset_hz !== null && msg.echo_offset_hz !== undefined
        ? ` · uplink ${formatHz(msg.echo_offset_hz)}` : '';
    return (
        <Tooltip title={map[1] + extra}>
            <Stack direction="row" spacing={0.5} alignItems="center"
                sx={{ fontSize: 15, color: msg.status === 'failed' ? 'error.contrastText' : 'inherit' }}>
                {map[0]}
                {msg.status === 'confirmed' && <Typography variant="caption" sx={{ fontWeight: 700 }}>via satellite</Typography>}
                {msg.status === 'failed' && <Typography variant="caption">{msg.error || 'failed'}</Typography>}
            </Stack>
        </Tooltip>
    );
}

function Body({ msg }) {
    if (msg.locked) {
        return (
            <Stack direction="row" spacing={1} alignItems="center" sx={{ opacity: 0.8 }}>
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
                        Broadcast: <Link href={`https://mempool.space/tx/${txid}`} target="_blank" rel="noreferrer">{txid.slice(0, 16)}…</Link>
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

function Bubble({ msg, onDelete }) {
    const out = msg.direction === 'tx';
    return (
        <Stack alignItems={out ? 'flex-end' : 'flex-start'} sx={{ '&:hover .bl21-del': { opacity: 1 } }}>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5, px: 1 }}>
                <Typography variant="caption" sx={{ fontWeight: 700 }}>{out ? 'You' : msg.callsign || 'Unknown station'}</Typography>
                <Typography variant="caption" color="text.secondary">{timeAgo(msg.created_at)}</Typography>
                {TYPE_LABEL[msg.payload_type] && <Chip size="small" label={TYPE_LABEL[msg.payload_type]} sx={{ height: 18, fontSize: 11 }} />}
                {msg.encrypted && !msg.locked && <LockRoundedIcon sx={{ fontSize: 14, color: 'text.secondary' }} />}
                <IconButton className="bl21-del" size="small" onClick={() => onDelete(msg.id)} sx={{ opacity: 0, transition: 'opacity .15s' }}>
                    <DeleteOutlineRoundedIcon sx={{ fontSize: 16 }} />
                </IconButton>
            </Stack>
            <Paper
                elevation={0}
                sx={{
                    px: 2, py: 1.2, maxWidth: { xs: '92%', md: '75%' }, borderRadius: 3,
                    borderTopRightRadius: out ? 4 : 24, borderTopLeftRadius: out ? 24 : 4,
                    bgcolor: out ? 'primary.main' : 'action.hover',
                    color: out ? 'primary.contrastText' : 'text.primary',
                }}
            >
                <Body msg={msg} />
                {out && <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 0.5, opacity: 0.9 }}><TxState msg={msg} /></Box>}
            </Paper>
        </Stack>
    );
}

export default function LinkFeed({ messages, files, onDelete, onDownloadFile }) {
    if (!messages.length && !files.length) {
        return (
            <Paper variant="outlined" sx={{ p: 4, borderRadius: 3, textAlign: 'center' }}>
                <Typography color="text.secondary">
                    No traffic yet. Messages you send and receive on this channel appear here.
                </Typography>
            </Paper>
        );
    }
    return (
        <Stack spacing={2}>
            {messages.map((m) => <Bubble key={m.id} msg={m} onDelete={onDelete} />)}
            {files.length > 0 && (
                <Paper variant="outlined" sx={{ p: 2, borderRadius: 3 }}>
                    <Typography variant="overline" color="text.secondary">Files received off air</Typography>
                    <Stack spacing={0.5} sx={{ mt: 1 }}>
                        {files.map((f) => (
                            <Stack key={f.id} direction="row" spacing={1} alignItems="center">
                                <InsertDriveFileOutlinedIcon fontSize="small" color="action" />
                                <Link component="button" variant="body2" onClick={() => onDownloadFile(f)}>{f.name}</Link>
                                <Typography variant="caption" color="text.secondary">
                                    {(f.size / 1024).toFixed(1)} kB · {timeAgo(f.created_at)}
                                </Typography>
                            </Stack>
                        ))}
                    </Stack>
                </Paper>
            )}
        </Stack>
    );
}
