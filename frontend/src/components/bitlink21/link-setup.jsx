import { useState } from 'react';
import {
    Alert, Box, Button, Card, CardActionArea, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel,
    Stack, Step, StepLabel, Stepper, Switch, TextField, ToggleButton, ToggleButtonGroup, Typography,
} from '@mui/material';
import SatelliteAltRoundedIcon from '@mui/icons-material/SatelliteAltRounded';

const STEPS = ['Satellite', 'Receiver', 'Your station'];

export default function LinkSetup({ open, settings, onFinish, busy }) {
    const [step, setStep] = useState(0);
    const [lnb, setLnb] = useState(String((settings?.profile?.lnb_lo_hz || 9750e6) / 1e6));
    const [lnbPreset, setLnbPreset] = useState('9750');
    const [host, setHost] = useState(settings?.pluto_host || '192.168.1.200');
    const [callsign, setCallsign] = useState(settings?.callsign || '');
    const [tx, setTx] = useState(false);

    const lnbHz = parseFloat(lnb) * 1e6;
    const valid = [true, lnbHz > 1e9 && !!host.trim(), !!callsign.trim()];

    const finish = () => onFinish({
        callsign: callsign.trim().toUpperCase(),
        pluto_host: host.trim(),
        tx_enabled: tx,
        setup_done: true,
        profile: { lnb_lo_hz: lnbHz },
    });

    return (
        <Dialog open={open} maxWidth="sm" fullWidth>
            <DialogTitle sx={{ fontWeight: 800 }}>Set up your BitLink21 station</DialogTitle>
            <DialogContent>
                <Stepper activeStep={step} alternativeLabel sx={{ my: 2 }}>
                    {STEPS.map((s) => <Step key={s}><StepLabel>{s}</StepLabel></Step>)}
                </Stepper>

                {step === 0 && (
                    <Stack spacing={2}>
                        <Typography color="text.secondary">Which satellite are you pointing at?</Typography>
                        <Card variant="outlined" sx={{ borderColor: 'primary.main', borderWidth: 2 }}>
                            <CardActionArea sx={{ p: 2 }}>
                                <Stack direction="row" spacing={2} alignItems="center">
                                    <SatelliteAltRoundedIcon color="primary" sx={{ fontSize: 40 }} />
                                    <Box>
                                        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>QO-100 narrowband (Es'hail-2, 25.9°E)</Typography>
                                        <Typography variant="body2" color="text.secondary">
                                            Downlink 10489.5–10490 MHz · uplink 2400.0–2400.5 MHz · locks to the PSK beacon
                                        </Typography>
                                    </Box>
                                </Stack>
                            </CardActionArea>
                        </Card>
                    </Stack>
                )}

                {step === 1 && (
                    <Stack spacing={2}>
                        <Typography color="text.secondary">Your LNB's local oscillator. Small errors are fine; the beacon lock finds and tracks them.</Typography>
                        <ToggleButtonGroup exclusive value={lnbPreset} onChange={(_, v) => {
                            if (!v) return;
                            setLnbPreset(v);
                            if (v !== 'custom') setLnb(v);
                        }}>
                            <ToggleButton value="9750">9750 MHz (standard)</ToggleButton>
                            <ToggleButton value="custom">Other</ToggleButton>
                        </ToggleButtonGroup>
                        {lnbPreset === 'custom' && (
                            <TextField label="LNB LO (MHz)" value={lnb} onChange={(e) => setLnb(e.target.value)} type="number" />
                        )}
                        <TextField label="PlutoSDR address" value={host} onChange={(e) => setHost(e.target.value)} helperText="IP address of your PlutoSDR" />
                    </Stack>
                )}

                {step === 2 && (
                    <Stack spacing={2}>
                        <TextField label="Callsign" value={callsign} onChange={(e) => setCallsign(e.target.value.toUpperCase())}
                            helperText="Sent with every message so stations can identify you" autoFocus />
                        <FormControlLabel control={<Switch color="warning" checked={tx} onChange={(e) => setTx(e.target.checked)} />}
                            label="Enable transmit" />
                        {tx ? (
                            <Alert severity="warning" variant="outlined">
                                You need an amateur licence that covers QO-100, and your 2.4 GHz PA and feed must be connected.
                            </Alert>
                        ) : (
                            <Alert severity="info" variant="outlined">You can start receive-only and switch transmit on later in Advanced.</Alert>
                        )}
                    </Stack>
                )}
            </DialogContent>
            <DialogActions sx={{ px: 3, pb: 2 }}>
                {step > 0 && <Button onClick={() => setStep(step - 1)} disabled={busy}>Back</Button>}
                <Box sx={{ flex: 1 }} />
                {step < STEPS.length - 1 ? (
                    <Button variant="contained" disabled={!valid[step]} onClick={() => setStep(step + 1)}>Next</Button>
                ) : (
                    <Button variant="contained" disabled={!valid[step] || busy} onClick={finish}>Start station</Button>
                )}
            </DialogActions>
        </Dialog>
    );
}
