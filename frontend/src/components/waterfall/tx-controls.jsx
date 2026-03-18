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

const TxControlsAccordion = ({ expanded, onAccordionChange }) => {
    const { t } = useTranslation('bitlink21');
    const dispatch = useDispatch();
    const socket = useSocket();
    const { pttActive, txFreq, txGain, outbox } = useSelector(state => state.bitlink21);
    const { centerFrequency, sampleRate } = useSelector(state => state.waterfall);
    const pendingCount = outbox?.pending_count || 0;

    const [modemScheme, setModemScheme] = useState('QPSK');
    const [fecEnabled, setFecEnabled] = useState(true);
    const [schemes, setSchemes] = useState([]);

    useEffect(() => {
        if (!socket) return;
        socket.emit('data_request', 'bitlink21:get_modem_schemes', null, (res) => {
            if (res.success && res.data) setSchemes(res.data);
        });
    }, [socket]);

    const selectedScheme = schemes.find(s => s.name === modemScheme);
    const bitsPerSymbol = selectedScheme?.bits_per_symbol || 2;
    const symbolRate = (sampleRate || 2048000) / 4; // 4 samples per symbol
    const fecRate = fecEnabled ? 0.875 : 1.0; // RS(255,223) rate
    const throughput = bitsPerSymbol * symbolRate * fecRate;

    const handlePttToggle = () => {
        const newState = !pttActive;
        dispatch(setPttActive(newState));
        if (socket) {
            socket.emit('data_submission', 'bitlink21:set_config', {
                key: 'ptt_active', value: String(newState)
            });
        }
    };

    const handleTxFreqChange = (value) => {
        const freq = parseFloat(value);
        if (!isNaN(freq)) {
            dispatch(setTxFreq(freq));
        }
    };

    const handleTxGainChange = (_, value) => {
        dispatch(setTxGain(value));
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

                    {/* Modem Scheme */}
                    <FormControl size="small" fullWidth>
                        <InputLabel>Modulation</InputLabel>
                        <Select
                            value={modemScheme}
                            label="Modulation"
                            onChange={e => setModemScheme(e.target.value)}
                        >
                            {schemes.length > 0 ? schemes.map(s => (
                                <MenuItem key={s.id} value={s.name}>
                                    {s.name} ({s.bits_per_symbol} bps)
                                </MenuItem>
                            )) : (
                                <MenuItem value="QPSK">QPSK (2 bps)</MenuItem>
                            )}
                        </Select>
                    </FormControl>

                    {/* FEC Toggle */}
                    <FormControlLabel
                        control={<Switch checked={fecEnabled} onChange={e => setFecEnabled(e.target.checked)} size="small" />}
                        label={<Typography variant="caption">FEC RS(255,223) {fecEnabled ? 'ON' : 'OFF'}</Typography>}
                    />

                    {/* Throughput Calculator */}
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Typography variant="caption" color="text.secondary">Throughput</Typography>
                        <Typography variant="body2" sx={{ fontFamily: 'monospace', fontWeight: 600 }}>
                            {throughput >= 1e6
                                ? `${(throughput / 1e6).toFixed(2)} Mbps`
                                : throughput >= 1e3
                                ? `${(throughput / 1e3).toFixed(1)} kbps`
                                : `${throughput.toFixed(0)} bps`}
                        </Typography>
                    </Box>
                </Box>
            </AccordionDetails>
        </Accordion>
    );
};

export default TxControlsAccordion;
