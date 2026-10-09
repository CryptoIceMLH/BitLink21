import { useEffect, useRef, useState } from 'react';
import { Box, LinearProgress, Paper, Stack, Tooltip, Typography } from '@mui/material';
import { keyframes } from '@mui/system';

// Live view of what the receiver is doing: decoding state, a strip of the
// most recent frames (green ok / red bad) and the file being received.

const MAX_FRAMES = 48;
const pulse = keyframes`
    0% { box-shadow: 0 0 0 0 currentColor; }
    70% { box-shadow: 0 0 0 8px transparent; }
    100% { box-shadow: 0 0 0 0 transparent; }
`;

// counters: { ok, bad } running totals (modem frames or DVB-S2 FEC frames)
function useFrameHistory(counters) {
    const [frames, setFrames] = useState([]);
    const [lastAt, setLastAt] = useState(null);
    const prev = useRef(null);

    useEffect(() => {
        if (!counters) {
            prev.current = null;
            return;
        }
        const { ok, bad } = counters;
        const p = prev.current;
        prev.current = { ok, bad };
        // First status after (re)start, or the counters were reset
        if (!p || ok < p.ok || bad < p.bad) return;
        const added = [...Array(Math.min(ok - p.ok, MAX_FRAMES)).fill(true), ...Array(Math.min(bad - p.bad, MAX_FRAMES)).fill(false)];
        if (added.length) {
            setFrames((f) => [...f, ...added].slice(-MAX_FRAMES));
            setLastAt(Date.now());
        }
    }, [counters?.ok, counters?.bad]);

    return { frames, lastAt };
}

function secondsAgo(t, now) {
    if (!t) return null;
    const s = Math.max(0, Math.round((now - t) / 1000));
    return s < 60 ? `${s} s ago` : `${Math.floor(s / 60)} min ago`;
}

export default function LinkActivity({ status, transmitting, txProgress }) {
    const modem = status?.modem;
    const wb = status?.wideband;
    const progress = status?.file_progress;
    const counters = wb
        ? { ok: Math.max(0, (wb.fec_frames || 0) - (wb.fec_errors || 0)), bad: wb.fec_errors || 0 }
        : modem ? { ok: modem.frames_ok || 0, bad: modem.frames_failed || 0 } : null;
    const { frames, lastAt } = useFrameHistory(counters);
    const [now, setNow] = useState(Date.now());

    useEffect(() => {
        const t = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(t);
    }, []);

    if (!status) return null;

    const recent = lastAt && now - lastAt < 5000;
    const mode = wb ? `DVB-S2 ${(wb.profile?.modcod || '').toUpperCase()}` : modem?.mode?.name || '';
    const locked = wb ? wb.lock : modem?.state === 'locked';
    const snr = wb ? (wb.snr_db !== null && wb.snr_db !== undefined ? wb.snr_db.toFixed(1) : null) : modem?.snr_db;
    let state;
    if (transmitting) {
        const p = txProgress?.progress;
        const left = p !== undefined && p !== null ? Math.max(0, Math.ceil((1 - p) * (txProgress.duration_s || 0))) : null;
        state = {
            color: 'error.main',
            title: p !== undefined && p !== null ? `Transmitting ${Math.round(p * 100)}%` : 'Transmitting',
            detail: left ? `${left} s left Â· listening for your echo` : 'Listening for your echo',
        };
    }
    else if (recent) state = { color: 'success.main', title: 'Data arriving', detail: `Decoding ${mode}` };
    else if (locked) state = { color: 'success.main', title: 'Decoding', detail: `Locked to a ${mode} signal, waiting for frames` };
    else if (!wb && modem?.signal_detected) state = { color: 'warning.main', title: 'Signal found', detail: `Syncing to ${mode}â€¦` };
    else state = { color: 'text.disabled', title: 'Listening', detail: 'No modem signal on this channel' };
    const live = transmitting || recent || locked;

    const ok = frames.filter(Boolean).length;
    const pct = progress?.total_chunks ? Math.min(100, (100 * progress.chunks) / progress.total_chunks) : null;

    return (
        <Paper variant="outlined" sx={{ p: 2, borderRadius: 3 }}>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ md: 'center' }}>
                <Stack direction="row" spacing={1.5} alignItems="center" sx={{ minWidth: 240 }}>
                    <Box
                        sx={{
                            width: 14, height: 14, borderRadius: '50%', flexShrink: 0,
                            bgcolor: state.color, color: state.color,
                            animation: live ? `${pulse} 1.4s infinite` : 'none',
                        }}
                    />
                    <Box sx={{ minWidth: 0 }}>
                        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{state.title}</Typography>
                        <Typography variant="caption" color="text.secondary" component="div" noWrap>{state.detail}</Typography>
                    </Box>
                </Stack>

                <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Tooltip title="Most recent frames: green decoded, red failed the error check">
                        <Stack direction="row" spacing={0.4} sx={{ height: 18, alignItems: 'flex-end', overflow: 'hidden' }}>
                            {Array.from({ length: MAX_FRAMES }, (_, i) => {
                                const f = frames[i - (MAX_FRAMES - frames.length)];
                                return (
                                    <Box
                                        key={i}
                                        sx={{
                                            flex: 1, minWidth: 3, maxWidth: 10, height: f === undefined ? 4 : 18, borderRadius: 0.5,
                                            bgcolor: f === undefined ? 'action.hover' : f ? 'success.main' : 'error.main',
                                            transition: 'height .2s',
                                        }}
                                    />
                                );
                            })}
                        </Stack>
                    </Tooltip>
                    <Stack direction="row" spacing={2} sx={{ mt: 0.5 }}>
                        <Typography variant="caption" color="text.secondary">
                            {frames.length ? `${ok} ok Â· ${frames.length - ok} bad (last ${frames.length})` : 'No frames yet'}
                        </Typography>
                        {lastAt && <Typography variant="caption" color="text.secondary">last frame {secondsAgo(lastAt, now)}</Typography>}
                        {status.channel && (
                            <Typography variant="caption" color={status.channel.busy ? 'warning.main' : 'text.secondary'}>
                                Channel {status.channel.busy ? 'busy' : 'clear'}
                            </Typography>
                        )}
                        {snr !== null && snr !== undefined && (
                            <Typography variant="caption" color="text.secondary">SNR {snr} dB</Typography>
                        )}
                        {wb && (
                            <Typography variant="caption" color="text.secondary">{Math.round((wb.net_bitrate || 0) / 1000)} kbit/s</Typography>
                        )}
                    </Stack>
                </Box>
            </Stack>

            {transmitting && txProgress?.progress !== undefined && (
                <Box sx={{ mt: 1.5 }}>
                    <Typography variant="caption" sx={{ fontWeight: 700 }}>Sending</Typography>
                    <LinearProgress variant="determinate" color="error" value={Math.min(100, txProgress.progress * 100)} sx={{ height: 6, borderRadius: 3, mt: 0.5 }} />
                </Box>
            )}

            {progress && (
                <Box sx={{ mt: 1.5 }}>
                    <Stack direction="row" justifyContent="space-between">
                        <Typography variant="caption" sx={{ fontWeight: 700 }} noWrap>Receiving {progress.name || 'file'}</Typography>
                        <Typography variant="caption" color="text.secondary">
                            {progress.chunks}{progress.total_chunks ? ` / ${progress.total_chunks}` : ''} frames
                        </Typography>
                    </Stack>
                    <LinearProgress
                        variant={pct === null ? 'indeterminate' : 'determinate'}
                        value={pct ?? 0}
                        sx={{ height: 6, borderRadius: 3, mt: 0.5 }}
                    />
                </Box>
            )}
        </Paper>
    );
}
