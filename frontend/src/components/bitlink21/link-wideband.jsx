import { memo, useEffect, useState } from 'react';
import {
    Alert, Box, Button, Chip, InputAdornment, MenuItem, Paper, Stack, TextField, ToggleButton, ToggleButtonGroup,
    Typography,
} from '@mui/material';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import { formatHz, formatMHz, parseFrequency } from './link-utils.js';

// Experimental wideband link: the same messages and files, carried over
// DVB-S2 on the QO-100 wideband transponder (much faster than HSModem).

const MODCOD_LABEL = {
    'qpsk1/2': 'QPSK 1/2 · most robust',
    'qpsk2/3': 'QPSK 2/3',
    'qpsk3/4': 'QPSK 3/4 · good default',
    'qpsk4/5': 'QPSK 4/5',
    'qpsk5/6': 'QPSK 5/6',
    '8psk2/3': '8PSK 2/3 · needs a strong signal',
    '8psk3/4': '8PSK 3/4',
    '8psk5/6': '8PSK 5/6 · fastest',
};

function kbps(bps) {
    return bps ? `${Math.round(bps / 1000)} kbit/s` : '—';
}

function LinkWideband({ wideband, plan, options, correctionHz, busy, onApply }) {
    const [freqText, setFreqText] = useState('');
    const [error, setError] = useState(null);

    useEffect(() => {
        if (wideband?.dl_rf_hz) setFreqText(formatMHz(wideband.dl_rf_hz, 3));
    }, [wideband?.dl_rf_hz]);

    if (!wideband || !options) return null;

    const parsed = parseFrequency(freqText);
    const changed = parsed && Math.abs(parsed - wideband.dl_rf_hz) > 0.5;

    const tune = () => {
        if (!parsed) {
            setError('Enter a frequency, e.g. 10494.750');
            return;
        }
        setError(null);
        onApply({ dl_rf_hz: parsed });
    };

    return (
        <Paper variant="outlined" sx={{ p: { xs: 2, md: 3 }, borderRadius: 3 }}>
            <Stack direction="row" spacing={1} alignItems="center">
                <Typography variant="overline" color="text.secondary">Wideband channel</Typography>
                <Chip size="small" color="warning" variant="outlined" label="Experimental · DVB-S2" />
            </Stack>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'flex-start' }} sx={{ mt: 1 }}>
                <TextField
                    value={freqText}
                    onChange={(e) => { setFreqText(e.target.value); setError(null); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') tune(); }}
                    error={!!error}
                    helperText={error || 'Downlink centre frequency of the DVB-S2 signal'}
                    placeholder="10494.750"
                    inputProps={{ inputMode: 'decimal', style: { fontSize: 32, fontWeight: 700, letterSpacing: 1 } }}
                    InputProps={{ endAdornment: <InputAdornment position="end">MHz</InputAdornment> }}
                    sx={{ flex: 1, '& .MuiInputBase-root': { borderRadius: 2 } }}
                />
                <Button
                    variant={changed ? 'contained' : 'outlined'}
                    size="large"
                    disabled={busy || !changed}
                    onClick={tune}
                    startIcon={changed ? null : <CheckRoundedIcon />}
                    sx={{ minWidth: 120, py: 1.6, borderRadius: 2 }}
                >
                    {changed ? 'Tune' : 'Tuned'}
                </Button>
            </Stack>

            <Typography variant="overline" color="text.secondary" component="div" sx={{ mt: 2 }}>Symbol rate</Typography>
            <ToggleButtonGroup
                exclusive
                fullWidth
                size="small"
                value={wideband.sym_rate}
                disabled={busy}
                onChange={(_, v) => v !== null && onApply({ sym_rate: v })}
            >
                {options.symbol_rates.map((r) => (
                    <ToggleButton key={r} value={r} sx={{ py: 1 }}>{Math.round(r / 1000)} kS/s</ToggleButton>
                ))}
            </ToggleButtonGroup>

            <TextField
                select
                fullWidth
                size="small"
                label="DVB-S2 mode"
                value={wideband.modcod}
                disabled={busy}
                onChange={(e) => onApply({ modcod: e.target.value })}
                sx={{ mt: 2 }}
            >
                {options.modcods.map((m) => <MenuItem key={m} value={m}>{MODCOD_LABEL[m] || m}</MenuItem>)}
            </TextField>

            {plan?.error ? (
                <Alert severity="error" variant="outlined" sx={{ mt: 2 }}>{plan.error}</Alert>
            ) : plan && (
                <Box sx={{ mt: 2, display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: 2, rowGap: 0.5 }}>
                    <Typography variant="body2" color="text.secondary">Data rate</Typography>
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>
                        {kbps(plan.net_bitrate)} · 100 kB in about {Math.ceil((100e3 * 8 * 2) / plan.net_bitrate + 2)} s
                    </Typography>
                    <Typography variant="body2" color="text.secondary">Occupied</Typography>
                    <Typography variant="body2">{Math.round(plan.occupied_bw_hz / 1000)} kHz</Typography>
                    <Typography variant="body2" color="text.secondary">Uplink</Typography>
                    <Typography variant="body2">{formatMHz(plan.ul_rf_hz, 4)} MHz</Typography>
                    <Typography variant="body2" color="text.secondary">LNB correction</Typography>
                    <Typography variant="body2">{formatHz(correctionHz)} (last narrowband beacon lock)</Typography>
                </Box>
            )}
            <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 2 }}>
                Messages and files go out as DVB-S2 (short frames, pilots, roll-off 0.35); any BitLink21 station on the same
                settings receives them. Wideband needs much more uplink power than narrowband. The narrowband station pauses
                while this mode is on.
            </Typography>
        </Paper>
    );
}

export default memo(LinkWideband);
