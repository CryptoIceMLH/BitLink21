import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, Chip, Paper, Stack, Switch, FormControlLabel, Typography, useTheme } from '@mui/material';
import RestartAltRoundedIcon from '@mui/icons-material/RestartAltRounded';
import { useSocket } from '../common/socket.jsx';
import { decodeFrame, drawSpectrum, updateLevels } from './radio-draw.js';

// Dish alignment on QO-100, in two modes:
//  - Find: before the beacon can be locked, the NB transponder's noise bump
//    above the empty spectrum beside it (what a waterfall shows when the dish
//    swings across the satellite) plus the whole receiver window.
//  - Fine: once the beacon is locked, its C/N0 by channel power (steady with
//    the beacon's modulation), MER, levels.
// Readings arrive ~15/s; everything moving is drawn on canvas in one
// requestAnimationFrame loop (no React re-render per reading).

const HISTORY_S = 60;
const KEEPALIVE_MS = 5000;
const SCALES = {
    fine: { min: 20, max: 55, unit: 'dB-Hz', label: 'Beacon C/N0', digits: 1 },
    find: { min: 0, max: 3, unit: 'dB', label: 'Transponder rise · finding the satellite', digits: 2 },
};

// Tone: fine = 2 semitones per dB of C/N0; find = an octave per 1.5 dB of rise
const toneFreq = (mode, v) => Math.min(3000, Math.max(120,
    mode === 'fine' ? 200 * 2 ** ((v - 30) / 6) : 220 * 2 ** (v / 1.5)));

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

const valueOf = (r, mode) => (!r ? null : mode === 'fine' ? r.cn0_dbhz : r.transponder_rise_db);

export default function AlignPage() {
    const { socket } = useSocket();
    const theme = useTheme();
    const latest = useRef(null);
    const mode = useRef('find');
    const shown = useRef(null);
    const hist = useRef({ fine: [], find: [] }); // [t_s, value]
    const best = useRef({ fine: null, find: null });
    const wide = useRef(null); // decoded whole-window spectrum
    const wideFrame = useRef(null);
    const wideLevels = useRef({});
    const numberEl = useRef(null);
    const unitEl = useRef(null);
    const labelEl = useRef(null);
    const deltaEl = useRef(null);
    const bar = useCanvas();
    const graph = useCanvas();
    const spec = useCanvas();
    const winRef = useCanvas();
    const audio = useRef(null);
    const [info, setInfo] = useState(null);
    const [error, setError] = useState(null);
    const [tone, setTone] = useState(false);

    // keep the meter (and the whole-window spectrum) running while this page is open
    useEffect(() => {
        if (!socket) return undefined;
        const ping = () => {
            socket.emit('data_submission', 'bitlink21:alignment_keepalive', {}, (res) => {
                setError(res?.success ? null : (res?.error || 'Alignment meter not available'));
            });
            socket.emit('data_submission', 'bitlink21:radio_keepalive', {}, () => {});
        };
        ping();
        const id = setInterval(ping, KEEPALIVE_MS);
        return () => clearInterval(id);
    }, [socket]);

    // readings
    useEffect(() => {
        if (!socket) return undefined;
        const onAlign = (r) => {
            latest.current = r;
            const m = r.beacon_state === 'locked' ? 'fine' : 'find';
            if (m !== mode.current) { mode.current = m; shown.current = null; }
            const v = valueOf(r, m);
            if (v !== null && v !== undefined) {
                hist.current[m].push([performance.now() / 1000, v]);
                if (best.current[m] === null || v > best.current[m]) best.current[m] = v;
            }
            const a = audio.current;
            if (a) {
                const t = a.ctx.currentTime;
                const on = v !== null && v !== undefined;
                a.gain.gain.setTargetAtTime(on ? 0.08 : 0, t, 0.03);
                if (on) a.osc.frequency.setTargetAtTime(toneFreq(m, v), t, 0.03);
            }
        };
        const onSpectrum = (f) => {
            if (f.span_hz < 0.95 * f.sample_rate) return; // a zoomed view from the Radio page
            wideFrame.current = f;
            wide.current = decodeFrame(f);
            wideLevels.current = updateLevels(wideLevels.current, wide.current.db);
        };
        socket.on('bitlink21:align', onAlign);
        socket.on('bitlink21:spectrum', onSpectrum);
        return () => {
            socket.off('bitlink21:align', onAlign);
            socket.off('bitlink21:spectrum', onSpectrum);
        };
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

    const resetBest = () => { best.current[mode.current] = shown.current; };

    // drawing loop
    useEffect(() => {
        let raf;
        const pal = theme.palette;
        const frame = () => {
            raf = requestAnimationFrame(frame);
            const r = latest.current;
            const m = mode.current;
            const sc = SCALES[m];
            const now = performance.now() / 1000;
            for (const k of ['fine', 'find']) {
                const h = hist.current[k];
                while (h.length && h[0][0] < now - HISTORY_S) h.shift();
            }
            const h = hist.current[m];
            const target = valueOf(r, m);
            if (target === null || target === undefined) shown.current = null;
            else shown.current = shown.current === null ? target : shown.current + 0.35 * (target - shown.current);
            const v = shown.current;
            const b0 = best.current[m];
            if (labelEl.current) labelEl.current.textContent = sc.label;
            if (unitEl.current) unitEl.current.textContent = sc.unit;
            if (numberEl.current) numberEl.current.textContent = v === null ? '—' : (m === 'find' && v > 0 ? '+' : '') + v.toFixed(sc.digits);
            if (deltaEl.current) {
                deltaEl.current.textContent = v === null || b0 === null ? '' : `${(v - b0).toFixed(sc.digits)} dB from best (${b0.toFixed(sc.digits)})`;
            }
            const frac = (x) => Math.max(0, Math.min(1, (x - sc.min) / (sc.max - sc.min)));
            const colour = (x) => (frac(x) >= 0.6 ? pal.success.main : frac(x) >= 0.35 ? pal.warning.main : pal.error.main);

            // bar
            const bc = bar.current;
            if (bc) {
                const g = bc.getContext('2d');
                const W = bc.width, H = bc.height, dpr = window.devicePixelRatio || 1;
                g.clearRect(0, 0, W, H);
                g.fillStyle = pal.action.hover;
                g.fillRect(0, 0, W, H);
                if (v !== null) {
                    g.fillStyle = colour(v);
                    g.fillRect(0, 0, frac(v) * W, H);
                }
                if (b0 !== null) {
                    g.fillStyle = pal.text.primary;
                    g.fillRect(frac(b0) * W - 1.5 * dpr, 0, 3 * dpr, H);
                }
            }

            // 60 s history of the active reading, auto-scaled
            const c = graph.current;
            if (c) {
                const g = c.getContext('2d');
                const W = c.width, H = c.height, dpr = window.devicePixelRatio || 1;
                g.clearRect(0, 0, W, H);
                if (h.length > 1) {
                    let lo = Infinity, hi = -Infinity;
                    for (const [, y] of h) { lo = Math.min(lo, y); hi = Math.max(hi, y); }
                    const minSpan = m === 'find' ? 1 : 4;
                    const mid = (lo + hi) / 2, span = Math.max(minSpan, (hi - lo) * 1.2);
                    lo = mid - span / 2; hi = mid + span / 2;
                    const px = (t) => W - ((now - t) / HISTORY_S) * W;
                    const py = (y) => H - ((y - lo) / (hi - lo)) * H;
                    g.strokeStyle = pal.divider;
                    g.fillStyle = pal.text.secondary;
                    g.font = `${11 * dpr}px sans-serif`;
                    g.lineWidth = dpr;
                    const step = span > 12 ? 5 : span > 6 ? 2 : span > 2.5 ? 1 : 0.5;
                    for (let y = Math.ceil(lo / step) * step; y <= hi; y += step) {
                        g.beginPath(); g.moveTo(0, py(y)); g.lineTo(W, py(y)); g.stroke();
                        g.fillText(`${+y.toFixed(1)}`, 4 * dpr, py(y) - 3 * dpr);
                    }
                    if (b0 !== null && b0 >= lo && b0 <= hi) {
                        g.setLineDash([6 * dpr, 4 * dpr]);
                        g.strokeStyle = pal.text.primary;
                        g.beginPath(); g.moveTo(0, py(b0)); g.lineTo(W, py(b0)); g.stroke();
                        g.setLineDash([]);
                    }
                    g.strokeStyle = pal.primary.main;
                    g.lineWidth = 2.5 * dpr;
                    g.beginPath();
                    h.forEach(([t, y], i) => (i ? g.lineTo(px(t), py(y)) : g.moveTo(px(t), py(y))));
                    g.stroke();
                }
            }

            // whole receiver window: the transponder's bump and the beacon
            if (winRef.current) {
                const f = wideFrame.current;
                drawSpectrum(winRef.current, wide.current, wideLevels.current, pal, {
                    bands: f ? [{ lo: f.transponder_rf_hz[0], hi: f.transponder_rf_hz[1], colour: pal.action.hover }] : [],
                    marks: f ? [{ rf: f.beacon_rf_hz, colour: pal.success.main, label: 'Beacon' }] : [],
                });
            }

            // beacon slot, 0 dB = noise floor
            const s = spec.current;
            if (s) {
                const g = s.getContext('2d');
                const W = s.width, H = s.height, dpr = window.devicePixelRatio || 1;
                g.clearRect(0, 0, W, H);
                const span = r?.spectrum_span_hz || 4800;
                const xf = (fr) => ((fr + span) / (2 * span)) * W;
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
    }, [theme, bar, graph, spec, winRef]);

    const finding = info?.state !== 'locked';
    const stateChip = {
        locked: { label: 'Beacon locked · fine tuning', color: 'success' },
        found: { label: 'Beacon found · locking', color: 'warning' },
        searching: { label: 'Finding the satellite', color: 'default' },
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
                        <Typography ref={labelEl} variant="overline" color="text.secondary">{SCALES.find.label}</Typography>
                        <Stack direction="row" alignItems="baseline" spacing={1}>
                            <Typography ref={numberEl} sx={{ fontSize: { xs: 72, md: 96 }, fontWeight: 800, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>—</Typography>
                            <Typography ref={unitEl} variant="h5" color="text.secondary">dB</Typography>
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
                    <Typography variant="caption" color="text.secondary">{finding ? '0 dB' : '20'}</Typography>
                    <Typography variant="caption" color="text.secondary">{finding ? '+3 dB' : '55 dB-Hz'}</Typography>
                </Stack>
                {finding ? (
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
                        Sweep slowly: the transponder&apos;s noise bump rises above the floor when the dish crosses the satellite
                        (about +1.5 to +2 dB on a well-aligned dish). Once the beacon locks, this switches to the beacon&apos;s C/N0 for fine tuning.
                    </Typography>
                ) : (
                    <Stack direction="row" spacing={3} sx={{ mt: 2, flexWrap: 'wrap', rowGap: 1 }}>
                        <Stat label="C/N (1.5 kHz)" value={info?.cn?.toFixed(1)} unit="dB" />
                        <Stat label="MER (quality)" value={info?.mer?.toFixed(1)} unit="dB" />
                        <Stat label="Beacon level" value={info?.beacon?.toFixed(1)} unit="dBFS" />
                        <Stat label="Noise floor" value={info?.noise?.toFixed(1)} unit="dBFS/Hz" />
                        <Stat label="LNB error" value={info?.lnb !== null && info?.lnb !== undefined ? (info.lnb / 1000).toFixed(2) : null} unit="kHz" />
                    </Stack>
                )}
            </Paper>

            <Paper variant="outlined" sx={{ p: 2, borderRadius: 3, mb: 2 }}>
                <Typography variant="overline" color="text.secondary">Whole receiver window · shaded = NB transponder</Typography>
                <Box component="canvas" ref={winRef} sx={{ width: '100%', height: 180, display: 'block' }} />
            </Paper>

            <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
                <Paper variant="outlined" sx={{ p: 2, borderRadius: 3, flex: 3 }}>
                    <Typography variant="overline" color="text.secondary">Last 60 s · dashed = best</Typography>
                    <Box component="canvas" ref={graph} sx={{ width: '100%', height: 200, display: 'block' }} />
                </Paper>
                <Paper variant="outlined" sx={{ p: 2, borderRadius: 3, flex: 2 }}>
                    <Typography variant="overline" color="text.secondary">Beacon slot · shaded = measured channel</Typography>
                    <Box component="canvas" ref={spec} sx={{ width: '100%', height: 200, display: 'block' }} />
                </Paper>
            </Stack>
        </Box>
    );
}
