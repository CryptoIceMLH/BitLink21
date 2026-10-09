import { useEffect, useMemo, useRef, useState } from 'react';
import {
    Alert, Box, Button, Divider, Drawer, FormControlLabel, IconButton, MenuItem, Slider, Stack, Switch, TextField,
    ToggleButton, ToggleButtonGroup, Typography,
} from '@mui/material';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded';
import { formatHz, formatMHz } from './link-utils.js';

function useCanvas(draw, deps) {
    const ref = useRef(null);
    useEffect(() => {
        const canvas = ref.current;
        if (!canvas) return;
        const dpr = window.devicePixelRatio || 1;
        const { width, height } = canvas.getBoundingClientRect();
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        const ctx = canvas.getContext('2d');
        ctx.scale(dpr, dpr);
        ctx.clearRect(0, 0, width, height);
        draw(ctx, width, height);
    }, deps);
    return ref;
}

function BeaconSpectrum({ beacon }) {
    const ref = useCanvas((ctx, w, h) => {
        const s = beacon?.spectrum;
        if (!s?.length) return;
        const min = Math.min(...s), max = Math.max(...s);
        ctx.strokeStyle = '#f7931a';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        s.forEach((v, i) => {
            const x = (i / (s.length - 1)) * w;
            const y = h - ((v - min) / (max - min || 1)) * (h - 6) - 3;
            if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
        });
        ctx.stroke();
        ctx.strokeStyle = beacon.locked ? 'rgba(76,175,80,.8)' : 'rgba(255,255,255,.25)';
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(w / 2, 0);
        ctx.lineTo(w / 2, h);
        ctx.stroke();
    }, [beacon?.spectrum, beacon?.locked]);
    return <canvas ref={ref} style={{ width: '100%', height: 90, display: 'block' }} />;
}

function Constellation({ points }) {
    const ref = useCanvas((ctx, w, h) => {
        ctx.strokeStyle = 'rgba(255,255,255,.12)';
        ctx.beginPath();
        ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2, h); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2);
        ctx.stroke();
        ctx.fillStyle = '#f7931a';
        const scale = Math.min(w, h) / 3.2;
        (points || []).forEach(([i, q]) => {
            ctx.fillRect(w / 2 + i * scale - 1, h / 2 - q * scale - 1, 2.2, 2.2);
        });
    }, [points]);
    return <canvas ref={ref} style={{ width: 150, height: 150, display: 'block', background: 'rgba(0,0,0,.25)', borderRadius: 8 }} />;
}

const Row = ({ label, value }) => (
    <Stack direction="row" justifyContent="space-between">
        <Typography variant="body2" color="text.secondary">{label}</Typography>
        <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums' }}>{value ?? '—'}</Typography>
    </Stack>
);

const Section = ({ title, children }) => (
    <Box>
        <Typography variant="overline" color="text.secondary">{title}</Typography>
        <Stack spacing={1.5} sx={{ mt: 0.5 }}>{children}</Stack>
    </Box>
);

export default function LinkAdvanced({
    open, onClose, settings, plan, status, modes, stationRunning, busy,
    onSave, onStart, onStop, onCalibrate,
}) {
    const profile = settings?.profile;
    const [form, setForm] = useState({});
    const [passphrase, setPassphrase] = useState('');

    useEffect(() => {
        if (!open || !settings) return;
        setForm({
            callsign: settings.callsign,
            pluto_host: settings.pluto_host,
            encryption: settings.encryption,
            tx_enabled: settings.tx_enabled,
            lnb_lo_mhz: profile.lnb_lo_hz / 1e6,
            rx_correction_hz: profile.rx_correction_hz,
            beacon_lock: profile.beacon_lock,
            search_span_hz: profile.search_span_hz,
            sample_rate_hz: profile.sample_rate_hz,
            rx_gain_db: profile.rx_gain_db,
            rx_mode: profile.rx_mode,
            tx_gain_db: profile.tx_gain_db,
            tx_correction_hz: profile.tx_correction_hz,
            uplink_lo_mhz: profile.uplink_lo_hz / 1e6,
        });
        setPassphrase('');
    }, [open, settings, profile]);

    const set = (key) => (e, v) => setForm((f) => ({ ...f, [key]: v !== undefined && typeof v !== 'object' ? v : e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

    const changes = useMemo(() => {
        if (!settings) return {};
        const out = {};
        const num = (v) => parseFloat(v);
        for (const k of ['callsign', 'pluto_host', 'encryption', 'tx_enabled']) {
            if (form[k] !== undefined && form[k] !== settings[k]) out[k] = k === 'callsign' ? String(form[k]).trim().toUpperCase() : form[k];
        }
        const p = {};
        const pmap = {
            lnb_lo_hz: num(form.lnb_lo_mhz) * 1e6,
            rx_correction_hz: num(form.rx_correction_hz),
            beacon_lock: form.beacon_lock,
            search_span_hz: num(form.search_span_hz),
            sample_rate_hz: num(form.sample_rate_hz),
            rx_gain_db: num(form.rx_gain_db),
            rx_mode: form.rx_mode,
            tx_gain_db: num(form.tx_gain_db),
            tx_correction_hz: num(form.tx_correction_hz),
            uplink_lo_hz: num(form.uplink_lo_mhz) * 1e6,
        };
        for (const [k, v] of Object.entries(pmap)) {
            if (v === undefined || (typeof v === 'number' && Number.isNaN(v))) continue;
            if (v !== profile[k]) p[k] = v;
        }
        if (Object.keys(p).length) out.profile = p;
        if (passphrase) out.passphrase = passphrase;
        return out;
    }, [form, passphrase, settings, profile]);

    if (!settings) return null;
    const beacon = status?.beacon;
    const modem = status?.modem;
    const progress = status?.file_progress;

    return (
        <Drawer anchor="right" open={open} onClose={onClose} PaperProps={{ sx: { width: { xs: '100%', sm: 440 } } }}>
            <Stack direction="row" alignItems="center" sx={{ px: 2, py: 1.5 }}>
                <Typography variant="h6" sx={{ flex: 1, fontWeight: 700 }}>Advanced</Typography>
                <IconButton onClick={onClose}><CloseRoundedIcon /></IconButton>
            </Stack>
            <Divider />
            <Stack spacing={3} sx={{ p: 2, overflowY: 'auto' }}>
                <Section title="Beacon lock">
                    <BeaconSpectrum beacon={beacon} />
                    <Row label="State" value={beacon ? (beacon.locked ? 'Locked' : 'Searching') : 'Off'} />
                    <Row label="Receive error (LNB + SDR)" value={formatHz(status?.correction_hz)} />
                    <Row label="Drift" value={beacon ? `${beacon.rate_hz_s} Hz/s` : null} />
                    <Row label="Beacon SNR" value={beacon?.snr_db !== null && beacon?.snr_db !== undefined ? `${beacon.snr_db} dB` : null} />
                    <Button size="small" variant="outlined" disabled={!beacon?.locked || (beacon?.locked_s || 0) < 10 || busy} onClick={onCalibrate}>
                        {beacon?.locked && (beacon?.locked_s || 0) < 10
                            ? `Hold steady… (${Math.ceil(10 - (beacon.locked_s || 0))} s)`
                            : 'Save current error as RX calibration'}
                    </Button>
                </Section>

                <Section title="Modem">
                    <Stack direction="row" spacing={2}>
                        <Constellation points={modem?.constellation} />
                        <Stack spacing={0.5} sx={{ flex: 1 }}>
                            <Row label="State" value={modem?.state} />
                            <Row label="Mode" value={modem?.mode?.name} />
                            <Row label="SNR" value={modem?.snr_db !== null && modem?.snr_db !== undefined ? `${modem.snr_db} dB` : null} />
                            <Row label="MER" value={modem?.mer_db !== null && modem?.mer_db !== undefined ? `${modem.mer_db} dB` : null} />
                            <Row label="Offset" value={formatHz(modem?.offset_hz)} />
                            <Row label="Frames ok / bad" value={modem ? `${modem.frames_ok} / ${modem.frames_failed}` : null} />
                        </Stack>
                    </Stack>
                    {progress && (
                        <Typography variant="caption" color="text.secondary">
                            Receiving {progress.name}: {progress.chunks}{progress.total_chunks ? ` / ${progress.total_chunks}` : ''} frames
                        </Typography>
                    )}
                    {status?.rx_dropped_recent > 0 ? (
                        <Alert severity="warning" variant="outlined">
                            Receiver falling behind right now ({status.rx_dropped_recent} buffers dropped in the last 10 s).
                            If this persists, lower the sample rate.
                        </Alert>
                    ) : status?.rx_dropped_buffers > 0 && (
                        <Typography variant="caption" color="text.secondary">
                            {status.rx_dropped_buffers} buffers dropped since start (none recently)
                        </Typography>
                    )}
                </Section>

                <Section title="Frequency plan">
                    <Row label="SDR centre (IF)" value={plan ? `${formatMHz(plan.rx_center_if_hz, 4)} MHz` : null} />
                    <Row label="Beacon / channel offset" value={plan ? `${formatHz(plan.beacon_offset_hz)} / ${formatHz(plan.rx_channel_offset_hz)}` : null} />
                    <Row label="Uplink SSB dial" value={plan?.tx_channel_rf_hz ? `${formatMHz(plan.tx_channel_rf_hz - 1500, 5)} MHz` : null} />
                    <Row label="Uplink (signal centre)" value={plan?.tx_channel_rf_hz ? `${formatMHz(plan.tx_channel_rf_hz, 5)} MHz` : null} />
                    <Row label="TX LO" value={plan?.tx_lo_hz ? `${formatMHz(plan.tx_lo_hz, 4)} MHz` : null} />
                    {(plan?.warnings || []).map((w) => <Alert key={w} severity="warning" variant="outlined">{w}</Alert>)}
                </Section>

                <Section title="Station">
                    <TextField label="Callsign" size="small" value={form.callsign ?? ''} onChange={set('callsign')} />
                    <TextField label="PlutoSDR address" size="small" value={form.pluto_host ?? ''} onChange={set('pluto_host')} helperText="IP address of the PlutoSDR" />
                    <Stack direction="row" spacing={1}>
                        <Button variant="outlined" disabled={busy || stationRunning} onClick={onStart}>Start radio</Button>
                        <Button variant="outlined" color="warning" disabled={busy || !stationRunning} onClick={onStop}>Stop radio</Button>
                    </Stack>
                </Section>

                <Section title="Receive">
                    <TextField label="LNB LO" size="small" type="number" value={form.lnb_lo_mhz ?? ''} onChange={set('lnb_lo_mhz')}
                        InputProps={{ endAdornment: <Typography variant="caption">MHz</Typography> }} />
                    <TextField label="RX calibration" size="small" type="number" value={form.rx_correction_hz ?? ''} onChange={set('rx_correction_hz')}
                        helperText="Known LNB error; the beacon lock tracks drift on top of it"
                        InputProps={{ endAdornment: <Typography variant="caption">Hz</Typography> }} />
                    <FormControlLabel control={<Switch checked={!!form.beacon_lock} onChange={set('beacon_lock')} />} label="Lock to the QO-100 beacon" />
                    <TextField select label="Exact speed mode" size="small" value={form.rx_mode ?? ''} onChange={set('rx_mode')}>
                        {modes.map((m) => <MenuItem key={m.index} value={m.index}>{m.name} ({m.symbol_rate.toFixed(0)} Bd)</MenuItem>)}
                    </TextField>
                    <TextField select label="Sample rate" size="small" value={form.sample_rate_hz ?? ''} onChange={set('sample_rate_hz')}>
                        {[600000, 1000000, 1500000, 2000000].map((r) => <MenuItem key={r} value={r}>{(r / 1e6).toFixed(1)} MS/s</MenuItem>)}
                    </TextField>
                    <Box>
                        <Typography variant="body2" color="text.secondary">RX gain: {form.rx_gain_db} dB</Typography>
                        <Slider min={0} max={70} value={Number(form.rx_gain_db ?? 30)} onChange={set('rx_gain_db')} />
                    </Box>
                    <TextField label="Search span" size="small" type="number" value={form.search_span_hz ?? ''} onChange={set('search_span_hz')}
                        helperText="How far around the channel the modem looks for a signal"
                        InputProps={{ endAdornment: <Typography variant="caption">Hz</Typography> }} />
                </Section>

                <Section title="Transmit">
                    <FormControlLabel
                        control={<Switch color="warning" checked={!!form.tx_enabled} onChange={set('tx_enabled')} />}
                        label="Transmit enabled"
                    />
                    {form.tx_enabled && !settings.tx_enabled && (
                        <Alert severity="warning" variant="outlined">
                            Only enable with a licence for QO-100, your PA/feed connected, and a free channel.
                        </Alert>
                    )}
                    <Box>
                        <Typography variant="body2" color="text.secondary">TX level: {form.tx_gain_db} dB</Typography>
                        <Slider min={-89} max={0} value={Number(form.tx_gain_db ?? -30)} onChange={set('tx_gain_db')} />
                    </Box>
                    <TextField label="TX correction" size="small" type="number" value={form.tx_correction_hz ?? ''} onChange={set('tx_correction_hz')}
                        InputProps={{ endAdornment: <Typography variant="caption">Hz</Typography> }} />
                    <TextField label="Upconverter LO" size="small" type="number" value={form.uplink_lo_mhz ?? ''} onChange={set('uplink_lo_mhz')}
                        helperText="0 when the PlutoSDR transmits directly on 2.4 GHz"
                        InputProps={{ endAdornment: <Typography variant="caption">MHz</Typography> }} />
                </Section>

                <Section title="Privacy">
                    <ToggleButtonGroup exclusive size="small" value={form.encryption} onChange={(_, v) => v && setForm((f) => ({ ...f, encryption: v }))}>
                        <ToggleButton value="clear">Clear by default</ToggleButton>
                        <ToggleButton value="passphrase">Encrypt by default</ToggleButton>
                    </ToggleButtonGroup>
                    <TextField label={settings.passphrase_set ? 'Change shared passphrase' : 'Shared passphrase'} size="small" type="password"
                        value={passphrase} onChange={(e) => setPassphrase(e.target.value)}
                        helperText="Stations with the same passphrase can read each other's encrypted messages. Check your licence: encryption is usually not allowed on amateur bands." />
                </Section>
                <Section title="Diagnostics">
                    <FormControlLabel
                        control={(
                            <Switch
                                checked={!!settings.verbose_logging}
                                disabled={busy}
                                onChange={(e) => onSave({ verbose_logging: e.target.checked })}
                            />
                        )}
                        label="Verbose logging (dev mode)"
                    />
                    <Typography variant="caption" color="text.secondary">
                        Detailed logs from the radio, modem, beacon tracker, wideband receiver and transmitter. Takes effect at once;
                        leave off normally.
                    </Typography>
                    <Button variant="outlined" startIcon={<DownloadRoundedIcon />} href="/api/bitlink21/diagnostics">
                        Download diagnostics
                    </Button>
                    <Typography variant="caption" color="text.secondary">
                        Zip with the logs, version, system info (CPU, memory, disk), radio status and settings. Your passphrase,
                        RPC password and message contents are not included.
                    </Typography>
                </Section>
            </Stack>
            <Box sx={{ mt: 'auto', p: 2, borderTop: 1, borderColor: 'divider' }}>
                <Button fullWidth variant="contained" disabled={busy || !Object.keys(changes).length} onClick={() => onSave(changes)}>
                    Save changes
                </Button>
            </Box>
        </Drawer>
    );
}
