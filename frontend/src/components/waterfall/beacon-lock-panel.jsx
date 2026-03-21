import React, { useState, useEffect, useCallback } from 'react';
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

const BeaconLockAccordion = ({ expanded, onAccordionChange }) => {
    const {socket} = useSocket();
    const dispatch = useDispatch();
    const { beaconMarkers, centerFrequency, selectedSDRId } = useSelector(state => state.waterfall);
    const { beaconMeasuring, beaconCorrecting, beaconOffset } = useSelector(state => state.bitlink21);

    const [xoCorrection, setXoCorrection] = useState(0);
    const [markerSpread, setMarkerSpread] = useState(500);
    const [beaconFreq, setBeaconFreq] = useState(centerFrequency || 0);

    const isPositioned = beaconMarkers?.active || false;

    // Converter for RF→IF (must be before any callback that uses it)
    const { converterDefinitions, activeConverterId } = useSelector(state => state.waterfall);
    const activeConverter = converterDefinitions?.find(c => c.id === activeConverterId);
    const rfToIF = (freq) => {
        if (!activeConverter || activeConverter.type === 'none') return freq;
        if (activeConverter.type === 'down') return freq - activeConverter.rxOffset;
        if (activeConverter.type === 'up') return freq + activeConverter.rxOffset;
        return freq;
    };

    // Update beaconFreq when center frequency changes (before positioning)
    useEffect(() => {
        if (!isPositioned && centerFrequency) setBeaconFreq(centerFrequency);
    }, [centerFrequency, isPositioned]);

    // When beacon frequency changes via input, move the markers
    const handleBeaconFreqChange = useCallback((newFreq) => {
        setBeaconFreq(newFreq);
        if (isPositioned && socket && !beaconCorrecting) {
            const low = newFreq - markerSpread;
            const high = newFreq + markerSpread;
            dispatch(setBeaconMarkers({ lowFreq: low, highFreq: high }));
            socket.emit('data_submission', 'bitlink21:beacon_config', {
                marker_low_hz: rfToIF(low),
                marker_high_hz: rfToIF(high),
                beacon_freq_hz: rfToIF(newFreq),
            });
        }
    }, [isPositioned, socket, beaconCorrecting, markerSpread, dispatch, rfToIF]);

    // Step 1: "Set Beacon" — show markers, start measuring (no correction)
    const handleSetBeacon = () => {
        if (!socket) return;
        const lowFreq = beaconFreq - markerSpread;
        const highFreq = beaconFreq + markerSpread;
        dispatch(setBeaconMarkers({ active: true, lowFreq, highFreq, lockState: 'TRACKING' }));
        socket.emit('data_submission', 'bitlink21:beacon_set_position', {
            beacon_freq_hz: rfToIF(beaconFreq),
            marker_low_hz: rfToIF(lowFreq),
            marker_high_hz: rfToIF(highFreq),
        });
    };

    // Step 2: "Lock" — start correcting
    const handleLock = () => {
        if (!socket) return;
        dispatch(setBeaconMarkers({ lockState: 'LOCKED' }));
        socket.emit('data_submission', 'bitlink21:beacon_lock', {});
    };

    // "Unlock" — stop correcting, keep measuring
    const handleUnlock = () => {
        if (!socket) return;
        dispatch(setBeaconMarkers({ lockState: 'TRACKING' }));
        socket.emit('data_submission', 'bitlink21:beacon_unlock', {});
    };

    // "Stop" — hide markers, stop everything
    const handleStop = () => {
        if (!socket) return;
        dispatch(setBeaconMarkers({ active: false, lockState: 'UNLOCKED', offsetHz: 0 }));
        socket.emit('data_submission', 'bitlink21:beacon_stop', {});
    };

    // Marker spread slider (only when positioned, not locked)
    const handleMarkerSpreadChange = (_, value) => {
        setMarkerSpread(value);
        if (isPositioned && !beaconCorrecting && socket) {
            const lowFreq = centerFrequency - value;
            const highFreq = centerFrequency + value;
            dispatch(setBeaconMarkers({ lowFreq, highFreq }));
            socket.emit('data_submission', 'bitlink21:beacon_config', {
                marker_low_hz: rfToIF(lowFreq),
                marker_high_hz: rfToIF(highFreq),
                beacon_freq_hz: rfToIF(centerFrequency),
            });
        }
    };

    const handleManualXO = () => {
        if (!socket || !selectedSDRId || selectedSDRId === 'none') return;
        socket.emit('sdr_data', 'configure-sdr', {
            selectedSDRId,
            xo_correction: parseInt(xoCorrection),
        });
    };

    // Sync marker lockState from backend
    useEffect(() => {
        if (beaconMarkers?.active) {
            const newState = beaconCorrecting ? 'LOCKED' : beaconMeasuring ? 'TRACKING' : 'UNLOCKED';
            dispatch(setBeaconMarkers({ lockState: newState, offsetHz: beaconOffset || 0 }));
        }
    }, [beaconMeasuring, beaconCorrecting, beaconOffset, dispatch, beaconMarkers?.active]);

    // Status text
    const statusText = beaconCorrecting ? 'LOCKED (correcting)' :
                       beaconMeasuring ? 'Measuring drift' : 'Inactive';
    const statusColor = beaconCorrecting ? 'success' : beaconMeasuring ? 'warning' : 'default';

    return (
        <Accordion expanded={expanded} onChange={onAccordionChange}>
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
                    <TrackChangesIcon fontSize="small" />
                    <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                        Beacon Lock
                    </Typography>
                    <Chip
                        icon={beaconCorrecting ? <LockIcon fontSize="small" /> : <LockOpenIcon fontSize="small" />}
                        label={beaconCorrecting ? 'LOCKED' : beaconMeasuring ? 'MEASURING' : 'OFF'}
                        color={statusColor}
                        size="small"
                        sx={{ ml: 'auto', mr: 1 }}
                    />
                </Box>
            </AccordionSummary>
            <AccordionDetails>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>

                    {/* Beacon frequency input */}
                    <Box>
                        <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
                            Beacon Frequency
                        </Typography>
                        <TextField
                            size="small"
                            fullWidth
                            value={(beaconFreq / 1e6).toFixed(3)}
                            onChange={e => {
                                const mhz = parseFloat(e.target.value);
                                if (!isNaN(mhz)) handleBeaconFreqChange(mhz * 1e6);
                            }}
                            type="number"
                            disabled={beaconCorrecting}
                            InputProps={{
                                endAdornment: <InputAdornment position="end">MHz</InputAdornment>,
                                sx: { fontFamily: 'monospace', fontSize: '0.9rem' },
                                inputProps: { step: 0.001 },
                            }}
                        />
                    </Box>

                    {/* Instructions */}
                    {!isPositioned && (
                        <Typography variant="caption" color="text.secondary" sx={{ fontStyle: 'italic' }}>
                            1. Tune frequency above to beacon{'\n'}
                            2. Click "Set Beacon" to show markers{'\n'}
                            3. Drag tab or use dial to position{'\n'}
                            4. Click "Lock" to correct drift
                        </Typography>
                    )}

                    {/* Marker spread (only when not locked) */}
                    {!beaconCorrecting && (
                        <Box>
                            <Typography variant="caption" color="text.secondary">
                                Marker Spread: ±{markerSpread} Hz ({(markerSpread * 2 / 1000).toFixed(1)} kHz)
                            </Typography>
                            <Slider
                                value={markerSpread}
                                onChange={handleMarkerSpreadChange}
                                min={100} max={10000} step={100}
                                size="small"
                                valueLabelDisplay="auto"
                                valueLabelFormat={v => `±${v} Hz`}
                            />
                        </Box>
                    )}

                    {/* Button row */}
                    <Box sx={{ display: 'flex', gap: 1 }}>
                        {!isPositioned ? (
                            <Button variant="contained" fullWidth onClick={handleSetBeacon} color="primary">
                                Set Beacon
                            </Button>
                        ) : (
                            <>
                                {!beaconCorrecting ? (
                                    <Button variant="contained" fullWidth onClick={handleLock} color="success">
                                        Lock
                                    </Button>
                                ) : (
                                    <Button variant="contained" fullWidth onClick={handleUnlock} color="warning">
                                        Unlock
                                    </Button>
                                )}
                                <Button variant="outlined" onClick={handleStop} color="error" sx={{ minWidth: 70 }}>
                                    Stop
                                </Button>
                            </>
                        )}
                    </Box>

                    {/* Drift display (when measuring) */}
                    {isPositioned && (
                        <>
                            <Divider />
                            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <Typography variant="caption" color="text.secondary">Drift</Typography>
                                <Typography variant="body2" sx={{ fontFamily: 'monospace', fontWeight: 600 }}>
                                    {beaconOffset > 0 ? '+' : ''}{(beaconOffset || 0).toFixed(1)} Hz
                                    {beaconCorrecting && (
                                        <Typography component="span" variant="caption" color="success.main" sx={{ ml: 1 }}>
                                            (corr)
                                        </Typography>
                                    )}
                                </Typography>
                            </Box>
                            <Typography variant="caption" color="text.secondary">
                                {statusText}
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
