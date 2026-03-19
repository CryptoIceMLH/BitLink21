import React, { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import {
    Accordion, AccordionSummary, AccordionDetails,
    Box, Typography, Slider, TextField, Button, Chip, Divider, InputAdornment,
    Select, MenuItem, FormControl, InputLabel, Switch, FormControlLabel
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import CellTowerIcon from '@mui/icons-material/CellTower';
import { setPttActive, setTxFreq, setTxGain } from '../bitlink21/bitlink21-slice.jsx';
import { useSocket } from '../common/socket.jsx';

const TestToneButton = ({ socket, txGain }) => {
    const [active, setActive] = useState(false);
    const [toneFreq, setToneFreq] = useState(1000);

    const handleToggle = () => {
        if (!socket) return;
        if (active) {
            socket.emit('data_submission', 'bitlink21:test_tone_stop', {}, (res) => {
                if (res?.success) setActive(false);
            });
        } else {
            socket.emit('data_submission', 'bitlink21:test_tone_start', {
                tone_freq_hz: toneFreq,
                tx_gain_db: txGain,
            }, (res) => {
                if (res?.success) setActive(true);
            });
        }
    };

    return (
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
            <Button
                variant="outlined"
                size="small"
                onClick={handleToggle}
                color={active ? 'error' : 'primary'}
                sx={{ flex: 1, fontSize: '0.8rem' }}
            >
                {active ? 'Stop Tone' : 'Test Tone'}
            </Button>
            <TextField
                size="small"
                value={toneFreq}
                onChange={e => setToneFreq(parseInt(e.target.value) || 1000)}
                type="number"
                InputProps={{
                    endAdornment: <InputAdornment position="end">Hz</InputAdornment>,
                    sx: { fontSize: '0.75rem' },
                    inputProps: { step: 100 },
                }}
                sx={{ width: 120 }}
                disabled={active}
            />
        </Box>
    );
};

const TxControlsAccordion = ({ expanded, onAccordionChange }) => {
    const { t } = useTranslation('bitlink21');
    const dispatch = useDispatch();
    const {socket} = useSocket();
    const { pttActive, txFreq, txGain, outbox } = useSelector(state => state.bitlink21);
    const { centerFrequency, sampleRate, selectedSDRId } = useSelector(state => state.waterfall);
    const pendingCount = outbox?.pending_count || 0;

    const [speedModeId, setSpeedModeId] = useState(5); // Default: QPSK 4800
    const [fecEnabled, setFecEnabled] = useState(true);

    // Import QO-100 NB speed modes
    const SSP_SPEED_MODES = [
        { id: 0,  scheme: 'BPSK', baudrate: 1200, bandwidth: 1500,  dataRate: 800,   label: 'BPSK 1200 (~1.5 kHz)' },
        { id: 1,  scheme: 'BPSK', baudrate: 2400, bandwidth: 3000,  dataRate: 2000,  label: 'BPSK 2400 (~3 kHz)' },
        { id: 2,  scheme: 'QPSK', baudrate: 3000, bandwidth: 2400,  dataRate: 2400,  label: 'QPSK 3000 (~2.4 kHz)' },
        { id: 3,  scheme: 'QPSK', baudrate: 4000, bandwidth: 3200,  dataRate: 3200,  label: 'QPSK 4000 (~3.2 kHz)' },
        { id: 4,  scheme: 'QPSK', baudrate: 4410, bandwidth: 3500,  dataRate: 3600,  label: 'QPSK 4410 (~3.5 kHz)' },
        { id: 5,  scheme: 'QPSK', baudrate: 4800, bandwidth: 3800,  dataRate: 4000,  label: 'QPSK 4800 (~3.8 kHz)' },
        { id: 6,  scheme: '8PSK', baudrate: 5500, bandwidth: 3700,  dataRate: 4400,  label: '8PSK 5500 (~3.7 kHz)' },
        { id: 7,  scheme: '8PSK', baudrate: 6000, bandwidth: 4000,  dataRate: 4800,  label: '8PSK 6000 (~4 kHz)' },
        { id: 8,  scheme: '8PSK', baudrate: 6600, bandwidth: 4400,  dataRate: 5200,  label: '8PSK 6600 (~4.4 kHz)' },
        { id: 9,  scheme: '8PSK', baudrate: 7200, bandwidth: 4800,  dataRate: 6000,  label: '8PSK 7200 (~4.8 kHz)' },
    ];

    const selectedMode = SSP_SPEED_MODES.find(m => m.id === speedModeId) || SSP_SPEED_MODES[5];
    const fecRate = fecEnabled ? 0.875 : 1.0;
    const throughput = selectedMode.dataRate * fecRate;

    const handlePttToggle = () => {
        const newState = !pttActive;
        dispatch(setPttActive(newState));
        if (socket) {
            const cmd = newState ? 'bitlink21:ptt_on' : 'bitlink21:ptt_off';
            socket.emit('data_submission', cmd, {
                scheme: selectedMode.scheme,
                baudrate: selectedMode.baudrate,
                bandwidth: selectedMode.bandwidth,
                use_fec: fecEnabled,
                sample_rate: sampleRate,
            }, (res) => {
                if (!res?.success) {
                    dispatch(setPttActive(false));
                    console.error('PTT failed:', res?.error);
                }
            });
        }
    };

    const handleTxFreqChange = (value) => {
        const freq = parseFloat(value);
        if (!isNaN(freq)) {
            dispatch(setTxFreq(freq));
            if (socket && selectedSDRId && selectedSDRId !== 'none') {
                socket.emit('sdr_data', 'configure-sdr', { selectedSDRId, tx_freq: freq });
            }
        }
    };

    const handleTxGainChange = (_, value) => {
        dispatch(setTxGain(value));
        if (socket && selectedSDRId && selectedSDRId !== 'none') {
            socket.emit('sdr_data', 'configure-sdr', { selectedSDRId, tx_gain: value });
        }
    };

    const handleCopyRxFreq = () => {
        if (centerFrequency) {
            dispatch(setTxFreq(centerFrequency));
        }
    };

    return (
        <Accordion expanded={expanded} onChange={onAccordionChange}>
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
                    <CellTowerIcon fontSize="small" />
                    <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                        {t('tx_controls', 'TX Controls')}
                    </Typography>
                    {pttActive && (
                        <Chip label="TX" color="error" size="small" sx={{ ml: 'auto', mr: 1, animation: 'pulse 1s infinite', '@keyframes pulse': { '0%, 100%': { opacity: 1 }, '50%': { opacity: 0.5 } } }} />
                    )}
                    {pendingCount > 0 && (
                        <Chip label={`${pendingCount} queued`} color="warning" size="small" />
                    )}
                </Box>
            </AccordionSummary>
            <AccordionDetails>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {/* PTT Button */}
                    <Button
                        variant="contained"
                        fullWidth
                        onClick={handlePttToggle}
                        sx={{
                            py: 1.5,
                            fontSize: '1.1rem',
                            fontWeight: 700,
                            backgroundColor: pttActive ? '#d32f2f' : '#388e3c',
                            '&:hover': { backgroundColor: pttActive ? '#b71c1c' : '#2e7d32' },
                        }}
                    >
                        {pttActive ? 'TX ON — Click to Stop' : 'PTT — Click to Transmit'}
                    </Button>

                    {/* Test Tone */}
                    <TestToneButton socket={socket} txGain={txGain} />

                    <Divider />

                    {/* TX Frequency */}
                    <Box>
                        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
                            <Typography variant="caption" color="text.secondary">
                                {t('tx_frequency', 'TX Frequency')}
                            </Typography>
                            <Button size="small" variant="text" onClick={handleCopyRxFreq} sx={{ fontSize: '0.7rem', minWidth: 'auto' }}>
                                Copy RX
                            </Button>
                        </Box>
                        <TextField
                            size="small"
                            fullWidth
                            value={txFreq || ''}
                            onChange={e => handleTxFreqChange(e.target.value)}
                            placeholder="e.g. 10489750000"
                            InputProps={{
                                endAdornment: <InputAdornment position="end">Hz</InputAdornment>,
                                sx: { fontFamily: 'monospace', fontSize: '0.85rem' },
                            }}
                        />
                    </Box>

                    {/* TX Gain (Attenuation) */}
                    <Box>
                        <Typography variant="caption" color="text.secondary">
                            {t('tx_gain', 'TX Gain')} ({txGain} dB)
                        </Typography>
                        <Slider
                            value={txGain}
                            onChange={handleTxGainChange}
                            min={-89.75}
                            max={0}
                            step={0.25}
                            size="small"
                            valueLabelDisplay="auto"
                            valueLabelFormat={v => `${v} dB`}
                        />
                        <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                            <Typography variant="caption" color="text.secondary">-89.75 dB (min)</Typography>
                            <Typography variant="caption" color="text.secondary">0 dB (max)</Typography>
                        </Box>
                    </Box>

                    <Divider />

                    {/* TX Queue Status */}
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Typography variant="caption" color="text.secondary">
                            {t('tx_queue', 'TX Queue')}
                        </Typography>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                            {pendingCount} {t('pending', 'pending')}
                        </Typography>
                    </Box>

                    <Divider />

                    {/* Speed Mode — QO-100 NB matched TX/RX modes */}
                    <FormControl size="small" fullWidth>
                        <InputLabel>Speed Mode</InputLabel>
                        <Select
                            value={speedModeId}
                            label="Speed Mode"
                            onChange={e => setSpeedModeId(e.target.value)}
                        >
                            {SSP_SPEED_MODES.map(m => (
                                <MenuItem key={m.id} value={m.id}>
                                    {m.label} — {m.dataRate} bps
                                </MenuItem>
                            ))}
                        </Select>
                    </FormControl>

                    {/* Mode details */}
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Typography variant="caption" color="text.secondary">Modulation</Typography>
                        <Typography variant="body2" sx={{ fontFamily: 'monospace', fontWeight: 600 }}>
                            {selectedMode.scheme} @ {selectedMode.baudrate} baud
                        </Typography>
                    </Box>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Typography variant="caption" color="text.secondary">Bandwidth</Typography>
                        <Typography variant="body2" sx={{ fontFamily: 'monospace', fontWeight: 600 }}>
                            ~{(selectedMode.bandwidth / 1000).toFixed(1)} kHz
                        </Typography>
                    </Box>

                    {/* FEC Toggle */}
                    <FormControlLabel
                        control={<Switch checked={fecEnabled} onChange={e => setFecEnabled(e.target.checked)} size="small" />}
                        label={<Typography variant="caption">FEC RS(255,223) {fecEnabled ? 'ON' : 'OFF'}</Typography>}
                    />

                    {/* Throughput */}
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Typography variant="caption" color="text.secondary">Data Rate</Typography>
                        <Typography variant="body2" sx={{ fontFamily: 'monospace', fontWeight: 600 }}>
                            {throughput >= 1000
                                ? `${(throughput / 1000).toFixed(1)} kbps`
                                : `${throughput.toFixed(0)} bps`}
                        </Typography>
                    </Box>
                </Box>
            </AccordionDetails>
        </Accordion>
    );
};

export default TxControlsAccordion;
