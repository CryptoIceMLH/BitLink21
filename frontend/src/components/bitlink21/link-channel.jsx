import { memo, useEffect, useState } from 'react';
import {
    Box, Button, Chip, InputAdornment, Paper, Stack, TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography,
} from '@mui/material';
import SouthRoundedIcon from '@mui/icons-material/SouthRounded';
import NorthRoundedIcon from '@mui/icons-material/NorthRounded';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import { SPEEDS, formatMHz, parseFrequency } from './link-utils.js';

const MM_BEACON_DIAL = 10489.9933e6;

function LinkChannel({ profile, plan, modes, busy, onApply }) {
    const [freqText, setFreqText] = useState('');
    const [error, setError] = useState(null);

    useEffect(() => {
        if (profile?.rx_dial_rf_hz) setFreqText(formatMHz(profile.rx_dial_rf_hz, 4));
    }, [profile?.rx_dial_rf_hz]);

    if (!profile) return null;

    const currentMode = modes.find((m) => m.index === profile.rx_mode);
    const parsed = parseFrequency(freqText);
    const changed = parsed && Math.abs(parsed - profile.rx_dial_rf_hz) > 0.5;

    const tune = (hz = parsed) => {
        if (!hz) {
            setError('Enter a frequency, e.g. 10489.600');
            return;
        }
        setError(null);
        onApply({ rx_dial_rf_hz: hz });
    };

    return (
        <Paper variant="outlined" sx={{ p: { xs: 2, md: 3 }, borderRadius: 3 }}>
            <Typography variant="overline" color="text.secondary">Channel</Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'flex-start' }} sx={{ mt: 1 }}>
                <TextField
                    value={freqText}
                    onChange={(e) => { setFreqText(e.target.value); setError(null); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') tune(); }}
                    error={!!error}
                    helperText={error || 'Downlink frequency as shown on the QO-100 WebSDR (SSB dial)'}
                    placeholder="10489.600"
                    inputProps={{ inputMode: 'decimal', style: { fontSize: 32, fontWeight: 700, letterSpacing: 1 } }}
                    InputProps={{ endAdornment: <InputAdornment position="end">MHz</InputAdornment> }}
                    sx={{ flex: 1, '& .MuiInputBase-root': { borderRadius: 2 } }}
                />
                <Button
                    variant={changed ? 'contained' : 'outlined'}
                    size="large"
                    disabled={busy || !changed}
                    onClick={() => tune()}
                    startIcon={changed ? null : <CheckRoundedIcon />}
                    sx={{ height: 64, minWidth: 140, px: 4, borderRadius: 2, fontWeight: 700 }}
                >
                    {changed ? 'Tune' : 'Tuned'}
                </Button>
            </Stack>

            <Stack direction="row" spacing={3} sx={{ mt: 1.5, color: 'text.secondary' }} flexWrap="wrap" useFlexGap>
                <Tooltip title="Where you listen (satellite downlink)">
                    <Stack direction="row" spacing={0.5} alignItems="center">
                        <SouthRoundedIcon fontSize="small" />
                        <Typography variant="body2">{formatMHz(profile.rx_dial_rf_hz, 4)} MHz</Typography>
                    </Stack>
                </Tooltip>
                <Tooltip title="Where you transmit (2.4 GHz uplink, includes any TX correction)">
                    <Stack direction="row" spacing={0.5} alignItems="center">
                        <NorthRoundedIcon fontSize="small" />
                        <Typography variant="body2">
                            {plan?.tx_dial_rf_hz ? `${formatMHz(plan.tx_dial_rf_hz, 4)} MHz` : '—'}
                            {profile.tx_correction_hz ? ` (${profile.tx_correction_hz > 0 ? '+' : ''}${profile.tx_correction_hz} Hz)` : ''}
                        </Typography>
                    </Stack>
                </Tooltip>
                <Chip
                    size="small"
                    variant="outlined"
                    label="Listen to the multimedia beacon"
                    onClick={() => { setFreqText(formatMHz(MM_BEACON_DIAL, 4)); tune(MM_BEACON_DIAL); }}
                    disabled={busy}
                />
            </Stack>

            <Box sx={{ mt: 3 }}>
                <Typography variant="overline" color="text.secondary">Speed</Typography>
                <ToggleButtonGroup
                    exclusive
                    fullWidth
                    value={profile.rx_mode}
                    onChange={(_, mode) => mode !== null && onApply({ rx_mode: mode })}
                    disabled={busy}
                    sx={{ mt: 1, flexWrap: { xs: 'wrap', sm: 'nowrap' } }}
                >
                    {SPEEDS.map((s) => (
                        <ToggleButton key={s.mode} value={s.mode} sx={{ py: 1.2, display: 'block', textTransform: 'none' }}>
                            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{s.label}</Typography>
                            <Typography variant="caption" color="text.secondary" component="div">{s.detail}</Typography>
                        </ToggleButton>
                    ))}
                </ToggleButtonGroup>
                {!SPEEDS.some((s) => s.mode === profile.rx_mode) && currentMode && (
                    <Typography variant="caption" color="text.secondary">Custom mode: {currentMode.name}</Typography>
                )}
            </Box>
        </Paper>
    );
}

export default memo(LinkChannel);
