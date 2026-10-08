import { Box, CircularProgress, Paper, Stack, Typography } from '@mui/material';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import RadioButtonUncheckedRoundedIcon from '@mui/icons-material/RadioButtonUncheckedRounded';
import ErrorRoundedIcon from '@mui/icons-material/ErrorRounded';
import { formatHz } from './link-utils.js';

// One step of the live checklist: ok | busy | wait | error
function Step({ state, title, detail }) {
    const icon = {
        ok: <CheckCircleRoundedIcon sx={{ color: 'success.main', fontSize: 30 }} />,
        busy: <CircularProgress size={26} thickness={5} />,
        error: <ErrorRoundedIcon sx={{ color: 'error.main', fontSize: 30 }} />,
        wait: <RadioButtonUncheckedRoundedIcon sx={{ color: 'text.disabled', fontSize: 30 }} />,
    }[state];
    return (
        <Stack direction="row" spacing={1.5} alignItems="center" sx={{ flex: 1, minWidth: 200 }}>
            <Box sx={{ width: 30, display: 'flex', justifyContent: 'center' }}>{icon}</Box>
            <Box sx={{ minWidth: 0 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700, color: state === 'wait' ? 'text.secondary' : 'text.primary' }}>
                    {title}
                </Typography>
                <Typography variant="caption" color="text.secondary" noWrap component="div">
                    {detail}
                </Typography>
            </Box>
        </Stack>
    );
}

export function linkSteps({ stationRunning, status, settings, plan, busy, stationError }) {
    const beacon = status?.beacon;
    const modem = status?.modem;

    const radio = stationError
        ? { state: 'error', detail: stationError }
        : stationRunning && status
            ? { state: 'ok', detail: `PlutoSDR · ${settings?.pluto_host || ''}` }
            : busy || stationRunning
                ? { state: 'busy', detail: 'Starting the radio…' }
                : { state: 'wait', detail: 'Radio is off' };

    let lock;
    if (radio.state !== 'ok') lock = { state: 'wait', detail: 'Waiting for the radio' };
    else if (!settings?.profile?.beacon_lock) lock = { state: 'ok', detail: 'Beacon lock off (fixed tuning)' };
    else if (beacon?.locked) {
        const drift = beacon.rate_hz_s ? ` · drift ${beacon.rate_hz_s > 0 ? '+' : ''}${beacon.rate_hz_s.toFixed(1)} Hz/s` : '';
        lock = { state: 'ok', detail: `LNB ${formatHz(status.correction_hz)}${drift}` };
    } else lock = { state: 'busy', detail: 'Finding the QO-100 beacon…' };

    let channel;
    if (lock.state !== 'ok') channel = { state: 'wait', detail: 'Waiting for satellite lock' };
    else if (modem?.state === 'locked') channel = { state: 'ok', detail: `Receiving · SNR ${modem.snr_db ?? '—'} dB` };
    else if (modem?.signal_detected) channel = { state: 'busy', detail: 'Signal found, syncing…' };
    else channel = { state: 'ok', detail: 'Listening · channel is quiet' };

    let ready;
    if (!settings?.tx_enabled) ready = { state: 'wait', detail: 'Receive only (TX switched off)' };
    else if (!settings?.callsign) ready = { state: 'error', detail: 'Set your callsign' };
    else if (plan && !plan.tx_allowed) ready = { state: 'error', detail: plan.tx_block_reason };
    else if (channel.state === 'wait') ready = { state: 'wait', detail: 'Waiting for the channel' };
    else ready = { state: 'ok', detail: 'Press send' };

    return { radio, lock, channel, ready };
}

export default function LinkStatus(props) {
    const { radio, lock, channel, ready } = linkSteps(props);
    return (
        <Paper variant="outlined" sx={{ p: 2, borderRadius: 3 }}>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} useFlexGap flexWrap="wrap">
                <Step {...radio} title="Radio" />
                <Step {...lock} title="Satellite lock" />
                <Step {...channel} title="Channel" />
                <Step {...ready} title="Ready to send" />
            </Stack>
        </Paper>
    );
}
