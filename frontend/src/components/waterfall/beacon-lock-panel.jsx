import React, { useState, useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
    Accordion, AccordionSummary, AccordionDetails,
    Box, Typography, Button, Chip, Divider, Slider, InputAdornment, TextField
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import LockIcon from '@mui/icons-material/Lock';
import LockOpenIcon from '@mui/icons-material/LockOpen';
import TrackChangesIcon from '@mui/icons-material/TrackChanges';
import { useSocket } from '../common/socket.jsx';
import { setBeaconMarkers } from './waterfall-slice.jsx';

const lockStateColors = {
    UNLOCKED: 'error',
    TRACKING: 'warning',
    LOCKED: 'success',
};

const lockStateIcons = {
    UNLOCKED: <LockOpenIcon fontSize="small" />,
    TRACKING: <TrackChangesIcon fontSize="small" />,
    LOCKED: <LockIcon fontSize="small" />,
};

const BeaconLockAccordion = ({ expanded, onAccordionChange }) => {
    const {socket} = useSocket();
    const dispatch = useDispatch();
    const { beaconMarkers, centerFrequency, sampleRate, selectedSDRId } = useSelector(state => state.waterfall);
    const { beaconLockState, beaconOffset, beaconPhaseError } = useSelector(state => state.bitlink21);

    const [xoCorrection, setXoCorrection] = useState(0);
    const [markerSpread, setMarkerSpread] = useState(2500); // ±Hz from center

    const isRunning = beaconMarkers?.active || false;
    const lockState = beaconLockState || 'UNLOCKED';

    // Get converter for RF→IF conversion (markers render in IF space on waterfall)
    const { converterDefinitions, activeConverterId } = useSelector(state => state.waterfall);
    const activeConverter = converterDefinitions?.find(c => c.id === activeConverterId);
    const rfToIF = (freq) => {
        if (!activeConverter || activeConverter.type === 'none') return freq;
        if (activeConverter.type === 'down') return freq - activeConverter.rxOffset;
        if (activeConverter.type === 'up') return freq + activeConverter.rxOffset;
        return freq;
    };

    // When markers are activated, set them around the center frequency (RF space — matches waterfall display)
    const handleStartLock = () => {
        if (!socket) return;

        // Markers in RF space (same as centerFrequency in Redux, same as waterfall display)
        const lowFreq = centerFrequency - markerSpread;
        const highFreq = centerFrequency + markerSpread;

        dispatch(setBeaconMarkers({
            active: true,
            lowFreq,
            highFreq,
            lockState: 'TRACKING',
        }));

        // Send RF frequency to backend for AFC
        socket.emit('data_submission', 'bitlink21:beacon_start', {
            beacon_freq_hz: centerFrequency,
            marker_low_hz: centerFrequency - markerSpread,
            marker_high_hz: centerFrequency + markerSpread,
        });
    };

    const handleStopLock = () => {
        if (!socket) return;
        dispatch(setBeaconMarkers({ active: false, lockState: 'UNLOCKED', offsetHz: 0 }));
        socket.emit('data_submission', 'bitlink21:beacon_stop', {});
    };

    const handleMarkerSpreadChange = (_, value) => {
        setMarkerSpread(value);
        if (isRunning && socket) {
            const lowFreq = centerFrequency - value;
            const highFreq = centerFrequency + value;
            dispatch(setBeaconMarkers({ lowFreq, highFreq }));
            socket.emit('data_submission', 'bitlink21:beacon_config', {
                marker_low_hz: centerFrequency - value,
                marker_high_hz: centerFrequency + value,
            });
        }
    };

    const handleManualXO = () => {
        if (!socket) return;
        if (selectedSDRId && selectedSDRId !== 'none') {
            socket.emit('sdr_data', 'configure-sdr', {
                selectedSDRId,
                xo_correction: parseInt(xoCorrection),
            });
        }
    };

    // Update lock state from backend
    useEffect(() => {
        if (beaconLockState && beaconMarkers?.active) {
            dispatch(setBeaconMarkers({
                lockState: beaconLockState,
                offsetHz: beaconOffset || 0,
            }));
        }
    }, [beaconLockState, beaconOffset, dispatch, beaconMarkers?.active]);

    return (
        <Accordion expanded={expanded} onChange={onAccordionChange}>
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
                    <TrackChangesIcon fontSize="small" />
                    <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                        Beacon Lock
                    </Typography>
                    <Chip
                        icon={lockStateIcons[lockState] || lockStateIcons.UNLOCKED}
                        label={lockState}
                        color={lockStateColors[lockState] || 'default'}
                        size="small"
                        sx={{ ml: 'auto', mr: 1 }}
                    />
                </Box>
            </AccordionSummary>
            <AccordionDetails>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {/* Marker spread control */}
                    <Box>
                        <Typography variant="caption" color="text.secondary">
                            Marker Spread: ±{markerSpread} Hz ({(markerSpread * 2 / 1000).toFixed(1)} kHz window)
                        </Typography>
                        <Slider
                            value={markerSpread}
                            onChange={handleMarkerSpreadChange}
                            min={500}
                            max={10000}
                            step={100}
                            size="small"
                            valueLabelDisplay="auto"
                            valueLabelFormat={v => `±${v} Hz`}
                        />
                    </Box>

                    {/* Lock/Unlock Button */}
                    <Button
                        variant="contained"
                        fullWidth
                        onClick={isRunning ? handleStopLock : handleStartLock}
                        color={isRunning ? 'error' : 'primary'}
                        sx={{ py: 1 }}
                    >
                        {isRunning ? 'Stop Beacon Lock' : 'Start Beacon Lock'}
                    </Button>

                    {/* Status when running */}
                    {isRunning && (
                        <>
                            <Divider />
                            <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                                <Typography variant="caption" color="text.secondary">Offset</Typography>
                                <Typography variant="body2" sx={{ fontFamily: 'monospace', fontWeight: 600 }}>
                                    {beaconOffset > 0 ? '+' : ''}{(beaconOffset || 0).toFixed(1)} Hz
                                </Typography>
                            </Box>
                            <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                                <Typography variant="caption" color="text.secondary">Phase Error</Typography>
                                <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                                    {(beaconPhaseError || 0).toFixed(2)}°
                                </Typography>
                            </Box>
                            <Typography variant="caption" color="text.secondary" sx={{ fontStyle: 'italic' }}>
                                Tune to beacon → markers show on waterfall → AFC auto-corrects
                            </Typography>
                        </>
                    )}

                    <Divider />

                    {/* Manual XO Correction */}
                    <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
                        Manual XO Correction
                    </Typography>
                    <Box sx={{ display: 'flex', gap: 1 }}>
                        <TextField
                            size="small"
                            value={xoCorrection}
                            onChange={e => setXoCorrection(parseInt(e.target.value) || 0)}
                            type="number"
                            InputProps={{
                                endAdornment: <InputAdornment position="end">Hz</InputAdornment>,
                                sx: { fontFamily: 'monospace', fontSize: '0.85rem' },
                                inputProps: { step: 1 },
                            }}
                            sx={{ flex: 1 }}
                        />
                        <Button variant="outlined" size="small" onClick={handleManualXO}>
                            Apply
                        </Button>
                    </Box>
                </Box>
            </AccordionDetails>
        </Accordion>
    );
};

export default BeaconLockAccordion;
