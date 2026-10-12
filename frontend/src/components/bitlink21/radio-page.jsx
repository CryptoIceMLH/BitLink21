import { useCallback, useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
    Alert, Box, Button, ButtonGroup, Chip, Paper, Slider, Stack, ToggleButton, ToggleButtonGroup, Typography, useTheme,
} from '@mui/material';
import VolumeUpRoundedIcon from '@mui/icons-material/VolumeUpRounded';
import VolumeOffRoundedIcon from '@mui/icons-material/VolumeOffRounded';
import { useSocket } from '../common/socket.jsx';
import { fetchState, startStation } from './bitlink21-slice.jsx';
import { AudioPlayer, Waterfall, decodeFrame, drawSpectrum, formatRf, updateLevels } from './radio-draw.js';

// The Radio page shows the BitLink21 station's own receiver window: it never
// retunes the SDR, so it cannot disturb the station. Frequencies are true RF
// (LNB and beacon correction applied by the station).

const KEEPALIVE_MS = 5000;
const ZOOMS = [
    { label: 'Full', span: 0 },
    { label: '200 kHz', span: 200e3 },
    { label: '50 kHz', span: 50e3 },
    { label: '10 kHz', span: 10e3 },
];
const PASSBAND = { usb: [200, 2900], lsb: [-2900, -200], cw: [450, 950] };
const DIAL_FROM_SIGNAL = { usb: -1500, lsb: 1500, cw: -700 }; // click on a signal -> dial
const STEPS = [-1000, -100, -10, 10, 100, 1000];

export default function RadioPage() {
    const { socket } = useSocket();
    const dispatch = useDispatch();
    const theme = useTheme();
    const { stationRunning, busy } = useSelector((s) => s.bitlink21);
    const specRef = useRef(null);
    const wfRef = useRef(null);
    const frame = useRef(null);
    const spec = useRef(null);
    const levels = useRef({});
    const peak = useRef(null);
    const wf = useRef(new Waterfall(320));
    const player = useRef(null);
    const dragging = useRef(false);
    const [info, setInfo] = useState(null);
    const [error, setError] = useState(null);
    const [zoom, setZoom] = useState(0); // span in Hz, 0 = whole window
    const [vfo, setVfo] = useState(null); // dial RF in Hz
    const [mode, setMode] = useState('usb');
    const [listening, setListening] = useState(false);
    const [volume, setVolume] = useState(0.7);
    const [hover, setHover] = useState(null);
    const vfoRef = useRef(null);
    const modeRef = useRef('usb');
    const centreRef = useRef(null);
    vfoRef.current = vfo;
    modeRef.current = mode;
    centreRef.current = info?.centre ?? null;

    useEffect(() => { if (socket) dispatch(fetchState({ socket })); }, [socket, dispatch]);

    // keep the station's radio view running, with the current zoom and VFO
    const ping = useCallback(() => {
        if (!socket) return;
        socket.emit('data_submission', 'bitlink21:radio_keepalive', {
            zoom_rf_hz: zoom ? (vfoRef.current ?? centreRef.current) : null,
            zoom_span_hz: zoom || null,
            vfo_rf_hz: listening ? vfoRef.current : null,
            vfo_mode: modeRef.current,
        }, (res) => setError(res?.success ? null : (res?.error || 'Radio not available')));
    }, [socket, zoom, listening]);
    useEffect(() => {
        ping();
        const id = setInterval(ping, KEEPALIVE_MS);
        return () => clearInterval(id);
    }, [ping, stationRunning]);
    useEffect(() => { // tuning while listening or zoomed: tell the station soon
        const id = setTimeout(ping, 120);
        return () => clearTimeout(id);
    }, [vfo, mode, ping]);

    // spectrum + audio streams
    useEffect(() => {
        if (!socket) return undefined;
        const onSpectrum = (f) => {
            frame.current = f;
            const s = decodeFrame(f);
            spec.current = s;
            levels.current = updateLevels(levels.current, s.db);
            if (!peak.current || peak.current.length !== s.db.length) peak.current = Float32Array.from(s.db);
            else for (let i = 0; i < s.db.length; i++) peak.current[i] = Math.max(s.db[i], peak.current[i] - 0.15);
            wf.current.push(s, levels.current);
        };
        const onAudio = (m) => player.current?.push(m);
        socket.on('bitlink21:spectrum', onSpectrum);
        socket.on('bitlink21:audio', onAudio);
        return () => {
            socket.off('bitlink21:spectrum', onSpectrum);
            socket.off('bitlink21:audio', onAudio);
        };
    }, [socket]);

    // slow text (4/s)
    useEffect(() => {
        const id = setInterval(() => {
            const f = frame.current;
            if (f) {
                setInfo({
                    locked: f.beacon_locked, window: f.window_rf_hz, centre: (f.window_rf_hz[0] + f.window_rf_hz[1]) / 2,
                    beacon: f.beacon_rf_hz, channel: f.channel_rf_hz, transponder: f.transponder_rf_hz,
                });
            }
        }, 250);
        return () => clearInterval(id);
    }, []);

    // drawing loop
    useEffect(() => {
        let raf;
        const pal = theme.palette;
        const loop = () => {
            raf = requestAnimationFrame(loop);
            const f = frame.current;
            const s = spec.current;
            if (specRef.current) {
                const v = vfoRef.current;
                const pb = PASSBAND[modeRef.current];
                drawSpectrum(specRef.current, s, levels.current, pal, {
                    peak: peak.current,
                    bands: f ? [{ lo: f.transponder_rf_hz[0], hi: f.transponder_rf_hz[1], colour: pal.action.hover }] : [],
                    marks: f ? [
                        { rf: f.beacon_rf_hz, colour: pal.success.main, label: 'Beacon' },
                        { rf: f.channel_rf_hz, colour: pal.info.main, label: 'Channel' },
                        ...(v ? [{ rf: v, colour: pal.warning.main, label: 'VFO' }] : []),
                    ] : [],
                    vfo: v ? { lo: v + pb[0], hi: v + pb[1] } : null,
                });
            }
            if (wfRef.current) wf.current.draw(wfRef.current);
        };
        raf = requestAnimationFrame(loop);
        return () => cancelAnimationFrame(raf);
    }, [theme]);

    useEffect(() => () => { player.current?.close(); player.current = null; }, []);

    const rfAt = (e) => {
        const s = spec.current;
        if (!s) return null;
        const r = e.currentTarget.getBoundingClientRect();
        return s.rfLo + ((e.clientX - r.left) / r.width) * (s.rfHi - s.rfLo);
    };
    const tuneTo = (signalRf) => setVfo(Math.round((signalRf + DIAL_FROM_SIGNAL[modeRef.current]) / 10) * 10);
    const onDown = (e) => { const rf = rfAt(e); if (rf) { dragging.current = true; tuneTo(rf); } };
    const onMove = (e) => {
        const rf = rfAt(e);
        setHover(rf);
        if (dragging.current && rf) tuneTo(rf);
    };
    const onUp = () => { dragging.current = false; };
    const onWheel = (e) => {
        if (vfoRef.current === null) return;
        setVfo(vfoRef.current + (e.deltaY < 0 ? 1 : -1) * (e.shiftKey ? 500 : 50));
    };

    const toggleListen = () => {
        if (listening) {
            player.current?.close();
            player.current = null;
            setListening(false);
            return;
        }
        player.current = new AudioPlayer(); // browsers allow audio only after a click
        player.current.setVolume(volume);
        if (vfo === null && info) tuneTo(info.channel);
        setListening(true);
    };
    useEffect(() => { player.current?.setVolume(volume); }, [volume]);

    const plotSx = { width: '100%', display: 'block', cursor: 'crosshair', touchAction: 'none' };
    return (
        <Box sx={{ p: { xs: 1.5, md: 3 }, maxWidth: 1600, mx: 'auto' }}>
            <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 2, flexWrap: 'wrap', rowGap: 1 }}>
                <Typography variant="h4" sx={{ fontWeight: 800 }}>Radio</Typography>
                {info && <Chip label={info.locked ? 'Beacon locked · true RF scale' : 'Beacon not locked · nominal RF scale'}
                    color={info.locked ? 'success' : 'default'} />}
                {info && <Chip variant="outlined" label={`${formatRf(info.window[0])} – ${formatRf(info.window[1])} MHz`} />}
            </Stack>
            {!stationRunning && (
                <Alert severity="info" sx={{ mb: 2 }} action={
                    <Button color="inherit" size="small" disabled={busy} onClick={() => dispatch(startStation({ socket }))}>Start station</Button>}>
                    The radio shows the station&apos;s receiver. Start the station to see the satellite.
                </Alert>
            )}
            {stationRunning && error && <Alert severity="warning" sx={{ mb: 2 }}>{error}</Alert>}

            <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 3, mb: 2 }}>
                <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1, flexWrap: 'wrap', rowGap: 1 }}>
                    <ToggleButtonGroup size="small" exclusive value={zoom} onChange={(e, v) => { if (v !== null) { setZoom(v); peak.current = null; } }}>
                        {ZOOMS.map((z) => <ToggleButton key={z.label} value={z.span}>{z.label}</ToggleButton>)}
                    </ToggleButtonGroup>
                    <Typography variant="body2" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                        {hover ? `${formatRf(hover)} MHz` : 'Click a signal to tune · drag or scroll to fine-tune (Shift = faster)'}
                    </Typography>
                </Stack>
                <Box component="canvas" ref={specRef} sx={{ ...plotSx, height: 220 }}
                    onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={() => { onUp(); setHover(null); }} onWheel={onWheel} />
                <Box component="canvas" ref={wfRef} sx={{ ...plotSx, height: 320 }}
                    onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={() => { onUp(); setHover(null); }} onWheel={onWheel} />
            </Paper>

            <Paper variant="outlined" sx={{ p: { xs: 2, md: 3 }, borderRadius: 3 }}>
                <Stack direction={{ xs: 'column', md: 'row' }} spacing={3} alignItems={{ md: 'center' }}>
                    <Box>
                        <Typography variant="overline" color="text.secondary">VFO dial</Typography>
                        <Typography sx={{ fontSize: { xs: 40, md: 52 }, fontWeight: 800, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
                            {vfo === null ? '—' : formatRf(vfo)}
                            <Typography component="span" variant="h6" color="text.secondary"> MHz</Typography>
                        </Typography>
                    </Box>
                    <Stack spacing={1.5} sx={{ flex: 1 }}>
                        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
                            <ToggleButtonGroup size="small" exclusive value={mode} onChange={(e, v) => v && setMode(v)}>
                                <ToggleButton value="usb">USB</ToggleButton>
                                <ToggleButton value="lsb">LSB</ToggleButton>
                                <ToggleButton value="cw">CW</ToggleButton>
                            </ToggleButtonGroup>
                            <ButtonGroup size="small" disabled={vfo === null}>
                                {STEPS.map((s) => (
                                    <Button key={s} onClick={() => setVfo(vfo + s)}>{s > 0 ? '+' : ''}{Math.abs(s) >= 1000 ? `${s / 1000}k` : s}</Button>
                                ))}
                            </ButtonGroup>
                        </Stack>
                        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
                            <Button size="small" variant="outlined" disabled={!info} onClick={() => tuneTo(info.beacon)}>Beacon</Button>
                            <Button size="small" variant="outlined" disabled={!info} onClick={() => tuneTo(info.channel)}>Our channel</Button>
                        </Stack>
                    </Stack>
                    <Stack direction="row" spacing={2} alignItems="center" sx={{ minWidth: 260 }}>
                        <Button variant={listening ? 'contained' : 'outlined'} color={listening ? 'warning' : 'primary'}
                            startIcon={listening ? <VolumeUpRoundedIcon /> : <VolumeOffRoundedIcon />}
                            disabled={!stationRunning} onClick={toggleListen}>
                            {listening ? 'Listening' : 'Listen'}
                        </Button>
                        <Slider size="small" value={volume} min={0} max={1} step={0.05} onChange={(e, v) => setVolume(v)} sx={{ flex: 1 }} />
                    </Stack>
                </Stack>
            </Paper>
        </Box>
    );
}
