import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, Chip, Paper, Stack, Switch, FormControlLabel, Typography, useTheme } from '@mui/material';
import RestartAltRoundedIcon from '@mui/icons-material/RestartAltRounded';
import { useSocket } from '../common/socket.jsx';

// Dish alignment on the QO-100 narrowband PSK beacon. Readings arrive ~15/s
// straight from the radio worker; everything moving is drawn on canvas in
// one requestAnimationFrame loop (no React re-render per reading).

const HISTORY_S = 60;
const KEEPALIVE_MS = 5000;
const BAR_MIN = 20; // dB-Hz
const BAR_MAX = 55;

const toneFreq = (cn0) => Math.min(3000, Math.max(120, 200 * 2 ** ((cn0 - 30) / 6))); // 2 semitones per dB

function useCanvas() {
    const ref = useRef(null);
    useEffect(() => {
        const c = ref.current;
        if (!c) return undefined;
        const fit = () => {
            const dpr = window.devicePixelRatio || 1;
            c.width = Math.max(1, Math.round(c.clientWidth * dpr));
            c.height = Math.max(1, Math.round(c.clientHeight * dpr));
        };
        fit();
        const ro = new ResizeObserver(fit);
        ro.observe(c);
        return () => ro.disconnect();
    }, []);
    return ref;
}

function Stat({ label, value, unit }) {
    return (
        <Box sx={{ minWidth: 110 }}>
            <Typography variant="caption" color="text.secondary">{label}</Typography>
            <Typography sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                {value ?? '—'}{value !== null && value !== undefined && unit ? <Typography component="span" variant="caption" color="text.secondary"> {unit}</Typography> : null}
            </Typography>
        </Box>
    );
}

export default function AlignPage() {
    const { socket } = useSocket();
    const theme = useTheme();
    const latest = useRef(null);
    const shown = useRef(null);
    const hist = useRef([]); // [t_s, cn0]
    const best = useRef(null);
    const numberEl = useRef(null);
    const deltaEl = useRef(null);
    const bar = useCanvas();
    const graph = useCanvas();
    const spec = useCanvas();
    const audio = useRef(null);
    const [info, setInfo] = useState(null);
    const [error, setError] = useState(null);
    const [tone, setTone] = useState(false);

    // keep the meter running while this page is open
    useEffect(() => {
        if (!socket) return undefined;
        const ping = () => socket.emit('data_submission', 'bitlink21:alignment_keepalive', {}, (res) => {
            setError(res?.success ? null : (res?.error || 'Alignment meter not available'));
        });
        ping();
        const id = setInterval(ping, KEEPALIVE_MS);
        return () => clearInterval(id);
    }, [socket]);

    // readings
    useEffect(() => {
        if (!socket) return undefined;
        const onAlign = (r) => {
            latest.current = r;
            const ok = r.cn0_dbhz !== null && r.cn0_dbhz !== undefined && r.beacon_state !== 'searching';
            if (ok) {
                hist.current.push([performance.now() / 1000, r.cn0_dbhz]);
                if (best.current === null || r.cn0_dbhz > best.current) best.current = r.cn0_dbhz;
            }
            const a = audio.current;
            if (a) {
                const t = a.ctx.currentTime;
                a.gain.gain.setTargetAtTime(ok ? 0.08 : 0, t, 0.03);
                if (ok) a.osc.frequency.setTargetAtTime(toneFreq(r.cn0_dbhz), t, 0.03);
            }
        };
        socket.on('bitlink21:align', onAlign);
        return () => socket.off('bitlink21:align', onAlign);
    }, [socket]);

    // slow text (4/s)
    useEffect(() => {
        const id = setInterval(() => {
            const r = latest.current;
            if (r) setInfo({ state: r.beacon_state, cn: r.cn_db, mer: r.mer_db, beacon: r.beacon_dbfs, noise: r.noise_dbfs_hz, lnb: r.lnb_error_hz });
        }, 250);
        return () => clearInterval(id);
    }, []);

    // keep the screen on while aligning
    useEffect(() => {
        let lock = null;
        navigator.wakeLock?.request('screen').then((l) => { lock = l; }).catch(() => {});
        return () => { lock?.release().catch(() => {}); };
    }, []);

    // tone on/off (browsers only allow audio after a click)
    const toggleTone = useCallback((on) => {
        setTone(on);
        if (on && !audio.current) {
            const Ctx = window.AudioContext || window.webkitAudioContext;
            if (!Ctx) return;
            const ctx = new Ctx();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            gain.gain.value = 0;
            osc.connect(gain).connect(ctx.destination);
            osc.start();
            audio.current = { ctx, osc, gain };
        } else if (!on && audio.current) {
            audio.current.ctx.close();
            audio.current = null;
        }
    }, []);
    useEffect(() => () => { audio.current?.ctx.close(); audio.current = null; }, []);

    const resetBest = () => { best.current = shown.current; };

    // drawing loop
    useEffect(() => {
        let raf;
        const pal = theme.palette;
        const colour = (v) => (v >= 40 ? pal.success.main : v >= 33 ? pal.warning.main : pal.error.main);
        const frame = () => {
            raf = requestAnimationFrame(frame);
            const r = latest.current;
            const now = performance.now() / 1000;
            const h = hist.current;
            while (h.length && h[0][0] < now - HISTORY_S) h.shift();
            const target = r && r.beacon_state !== 'searching' ? r.cn0_dbhz : null;
            if (target === null || target === undefined) shown.current = null;
            else shown.current = shown.current === null ? target : shown.current + 0.35 * (target - shown.current);
            const v = shown.current;
            if (numberEl.current) numberEl.current.textContent = v === null ? '—' : v.toFixed(1);
            if (deltaEl.current) {
                deltaEl.current.textContent = v === null || best.current === null ? '' : `${(v - best.current).toFixed(1)} dB from best (${best.current.toFixed(1)})`;
            }

            // bar
            const b = bar.current;
            if (b) {
                const g = b.getContext('2d');
                const W = b.width, H = b.height;
                g.clearRect(0, 0, W, H);
                g.fillStyle = pal.action.hover;
                g.fillRect(0, 0, W, H);
                if (v !== null) {
                    const x = Math.max(0, Math.min(1, (v - BAR_MIN) / (BAR_MAX - BAR_MIN))) * W;
                    g.fillStyle = colour(v);
                    g.fillRect(0, 0, x, H);
                }
                if (best.current !== null) {
                    const bx = Math.max(0, Math.min(1, (best.current - BAR_MIN) / (BAR_MAX - BAR_MIN))) * W;
                    g.fillStyle = pal.text.primary;
                    g.fillRect(bx - 1.5 * (window.devicePixelRatio || 1), 0, 3 * (window.devicePixelRatio || 1), H);
                }
            }

            // 60 s history, auto-scaled so small changes are visible
            const c = graph.current;
            if (c) {
                const g = c.getContext('2d');
                const W = c.width, H = c.height, dpr = window.devicePixelRatio || 1;
                g.clearRect(0, 0, W, H);
                if (h.length > 1) {
                    let lo = Infinity, hi = -Infinity;
                    for (const [, y] of h) { lo = Math.min(lo, y); hi = Math.max(hi, y); }
                    const mid = (lo + hi) / 2, span = Math.max(4, hi - lo + 1);
                    lo = mid - span / 2; hi = mid + span / 2;
                    const px = (t) => W - ((now - t) / HISTORY_S) * W;
                    const py = (y) => H - ((y - lo) / (hi - lo)) * H;
                    g.strokeStyle = pal.divider;
                    g.fillStyle = pal.text.secondary;
                    g.font = `${11 * dpr}px sans-serif`;
                    g.lineWidth = dpr;
                    const step = span > 12 ? 5 : span > 6 ? 2 : 1;
                    for (let y = Math.ceil(lo / step) * step; y <= hi; y += step) {
                        g.beginPath(); g.moveTo(0, py(y)); g.lineTo(W, py(y)); g.stroke();
                        g.fillText(`${y}`, 4 * dpr, py(y) - 3 * dpr);
                    }
                    if (best.current !== null && best.current >= lo && best.current <= hi) {
                        g.setLineDash([6 * dpr, 4 * dpr]);
                        g.strokeStyle = pal.text.primary;
                        g.beginPath(); g.moveTo(0, py(best.current)); g.lineTo(W, py(best.current)); g.stroke();
                        g.setLineDash([]);
                    }
                    g.strokeStyle = pal.primary.main;
                    g.lineWidth = 2.5 * dpr;
                    g.beginPath();
                    h.forEach(([t, y], i) => (i ? g.lineTo(px(t), py(y)) : g.moveTo(px(t), py(y))));
                    g.stroke();
                }
            }

            // spectrum of the beacon's slot, 0 dB = noise floor
            const s = spec.current;
            if (s) {
                const g = s.getContext('2d');
                const W = s.width, H = s.height, dpr = window.devicePixelRatio || 1;
                g.clearRect(0, 0, W, H);
                const span = r?.spectrum_span_hz || 4800;
                const xf = (f) => ((f + span) / (2 * span)) * W;
                g.fillStyle = pal.action.hover;
                g.fillRect(xf(-750), 0, xf(750) - xf(-750), H); // beacon channel
                const yd = (db) => H - (db / 30) * H;
                g.strokeStyle = pal.divider;
                g.lineWidth = dpr;
                for (const db of [10, 20]) { g.beginPath(); g.moveTo(0, yd(db)); g.lineTo(W, yd(db)); g.stroke(); }
                const bins = r?.spectrum;
                if (bins?.length) {
                    g.beginPath();
                    g.moveTo(0, H);
                    bins.forEach((q, i) => g.lineTo(((i + 0.5) / bins.length) * W, yd(Math.min(30, q / 2))));
                    g.lineTo(W, H);
                    g.closePath();
                    g.fillStyle = pal.primary.main + '55';
                    g.fill();
                    g.strokeStyle = pal.primary.main;
                    g.lineWidth = 1.5 * dpr;
                    g.stroke();
                }
                g.fillStyle = pal.text.secondary;
                g.font = `${11 * dpr}px sans-serif`;
                g.fillText('−4.8 kHz', 4 * dpr, H - 4 * dpr);
                g.fillText('+4.8 kHz', W - 52 * dpr, H - 4 * dpr);
                g.fillText('20 dB', 4 * dpr, yd(20) - 3 * dpr);
            }
        };
        raf = requestAnimationFrame(frame);
        return () => cancelAnimationFrame(raf);
    }, [theme, bar, graph, spec]);

    const stateChip = {
        locked: { label: 'Beacon locked', color: 'success' },
        found: { label: 'Beacon found', color: 'warning' },
        searching: { label: 'Searching for the beacon', color: 'default' },
    }[info?.state] || { label: 'Waiting for the receiver', color: 'default' };

    return (
        <Box sx={{ p: { xs: 1.5, md: 3 }, maxWidth: 1100, mx: 'auto' }}>
            <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 2, flexWrap: 'wrap' }}>
                <Typography variant="h4" sx={{ fontWeight: 800 }}>Dish alignment</Typography>
                <Chip label={stateChip.label} color={stateChip.color} />
            </Stack>
            {error && <Alert severity="warning" sx={{ mb: 2 }}>{error}</Alert>}

            <Paper variant="outlined" sx={{ p: { xs: 2, md: 3 }, borderRadius: 3, mb: 2 }}>
                <Stack direction={{ xs: 'column', sm: 'row' }} alignItems={{ sm: 'flex-end' }} spacing={2} justifyContent="space-between">
                    <Box>
                        <Typography variant="overline" color="text.secondary">Beacon C/N0</Typography>
                        <Stack direction="row" alignItems="baseline" spacing={1}>
                            <Typography ref={numberEl} sx={{ fontSize: { xs: 72, md: 96 }, fontWeight: 800, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>—</Typography>
                            <Typography variant="h5" color="text.secondary">dB-Hz</Typography>
                        </Stack>
                        <Typography ref={deltaEl} variant="h6" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums', minHeight: 32 }} />
                    </Box>
                    <Stack direction="row" spacing={1} alignItems="center">
                        <FormControlLabel control={<Switch checked={tone} onChange={(e) => toggleTone(e.target.checked)} />} label="Tone" />
                        <Button variant="outlined" startIcon={<RestartAltRoundedIcon />} onClick={resetBest}>Reset best</Button>
                    </Stack>
                </Stack>
                <Box component="canvas" ref={bar} sx={{ width: '100%', height: 18, mt: 2, borderRadius: 1, display: 'block' }} />
                <Stack direction="row" justifyContent="space-between">
                    <Typography variant="caption" color="text.secondary">{BAR_MIN}</Typography>
                    <Typography variant="caption" color="text.secondary">{BAR_MAX} dB-Hz</Typography>
                </Stack>
                <Stack direction="row" spacing={3} sx={{ mt: 2, flexWrap: 'wrap', rowGap: 1 }}>
                    <Stat label="C/N (1.5 kHz)" value={info?.cn?.toFixed(1)} unit="dB" />
                    <Stat label="MER (quality)" value={info?.mer?.toFixed(1)} unit="dB" />
                    <Stat label="Beacon level" value={info?.beacon?.toFixed(1)} unit="dBFS" />
                    <Stat label="Noise floor" value={info?.noise?.toFixed(1)} unit="dBFS/Hz" />
                    <Stat label="LNB error" value={info?.lnb !== null && info?.lnb !== undefined ? (info.lnb / 1000).toFixed(2) : null} unit="kHz" />
                </Stack>
            </Paper>

            <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ mb: 2 }}>
                <Paper variant="outlined" sx={{ p: 2, borderRadius: 3, flex: 3 }}>
                    <Typography variant="overline" color="text.secondary">Last 60 s · dashed = best</Typography>
                    <Box component="canvas" ref={graph} sx={{ width: '100%', height: 200, display: 'block' }} />
                </Paper>
                <Paper variant="outlined" sx={{ p: 2, borderRadius: 3, flex: 2 }}>
                    <Typography variant="overline" color="text.secondary">Beacon slot · shaded = measured channel</Typography>
                    <Box component="canvas" ref={spec} sx={{ width: '100%', height: 200, display: 'block' }} />
                </Paper>
            </Stack>

            <Paper variant="outlined" sx={{ p: 2, borderRadius: 3 }}>
                <Typography variant="overline" color="text.secondary">How to align</Typography>
                <Typography variant="body2" component="div">
                    <ol style={{ margin: 0, paddingLeft: 20 }}>
                        <li>Point roughly (pointing calculator) until the beacon is found.</li>
                        <li>Azimuth: move in small steps and peak C/N0.</li>
                        <li>Elevation: the same.</li>
                        <li>LNB skew: rotate slowly and peak again.</li>
                        <li>Tighten the bolts, then check you are still at 0 dB from best.</li>
                    </ol>
                    C/N0 is the beacon&apos;s total power over its ±750 Hz channel against the noise in its empty guard bands,
                    so it does not jump with the beacon&apos;s modulation. MER confirms the signal is clean.
                </Typography>
            </Paper>
        </Box>
    );
}
