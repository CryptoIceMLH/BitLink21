import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
    Accordion, AccordionSummary, AccordionDetails,
    Box, Typography, Button, Chip, Divider, Slider, InputAdornment, TextField
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import LockIcon from '@mui/icons-material/Lock';
import LockOpenIcon from '@mui/icons-material/LockOpen';
import TrackChangesIcon from '@mui/icons-material/TrackChanges';
import { useTheme } from '@mui/material/styles';
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

const SPECTRUM_HEIGHT = 80;

/**
 * Mini beacon spectrum canvas — shows the narrow-band FFT around the beacon.
 * Data comes from Redux beaconSpectrum (populated by worker → Socket.IO).
 * Dual-tone peaks drawn as vertical markers when locked.
 */
const BeaconSpectrumCanvas = () => {
    const canvasRef = useRef(null);
    const theme = useTheme();
    const { beaconSpectrum, beaconPeaks, beaconLockState, beaconOffset, beaconNcoCorrection } =
        useSelector(state => state.bitlink21);

    const lockColor = beaconLockState === 'LOCKED' ? '#4caf50' :
                      beaconLockState === 'TRACKING' ? '#ff9800' : '#f44336';

    const draw = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const w = canvas.clientWidth;
        const h = SPECTRUM_HEIGHT;
        const dpr = window.devicePixelRatio || 1;
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        ctx.scale(dpr, dpr);

        // Background
        ctx.fillStyle = '#0a0f0a';
        ctx.fillRect(0, 0, w, h);

        // Grid
        ctx.strokeStyle = '#1a2a1a';
        ctx.lineWidth = 0.5;
        for (let y = 0; y < h; y += 16) {
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
        }
        for (let x = 0; x < w; x += w / 10) {
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
        }

        if (beaconSpectrum && beaconSpectrum.length > 0) {
            const numBins = beaconSpectrum.length;
            const binWidth = w / numBins;

            // Auto-scale
            let minDb = Infinity, maxDb = -Infinity;
            for (const v of beaconSpectrum) {
                if (v < minDb) minDb = v;
                if (v > maxDb) maxDb = v;
            }
            const rangeDb = Math.max(maxDb - minDb, 10);

            // Spectrum line
            ctx.strokeStyle = lockColor;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            for (let i = 0; i < numBins; i++) {
                const x = i * binWidth;
                const normalized = (beaconSpectrum[i] - minDb) / rangeDb;
                const y = h - 5 - normalized * (h - 10);
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.stroke();

            // Dual-tone peak markers
            if (beaconPeaks && beaconPeaks.length >= 2) {
                // Peaks are in Hz relative to baseband. Map to canvas bins.
                // Spectrum spans from -decimated_rate/2 to +decimated_rate/2
                // Approximate: peaks are Hz offsets, spectrum is centered
                const halfSpan = numBins; // bins span the full decimated bandwidth
                for (const peakHz of beaconPeaks) {
                    // Map Hz to bin position (assuming ~2 Hz/bin, centered at 0)
                    const peakBin = peakHz / 2 + numBins / 2;
                    const px = peakBin * binWidth;
                    if (px >= 0 && px <= w) {
                        ctx.strokeStyle = '#ffeb3b';
                        ctx.lineWidth = 1;
                        ctx.setLineDash([3, 3]);
                        ctx.beginPath();
                        ctx.moveTo(px, 0);
                        ctx.lineTo(px, h);
                        ctx.stroke();
                        ctx.setLineDash([]);
                    }
                }
            }

            // Center marker
            ctx.strokeStyle = '#666';
            ctx.lineWidth = 1;
            ctx.setLineDash([2, 4]);
            ctx.beginPath();
            ctx.moveTo(w / 2, 0);
            ctx.lineTo(w / 2, h);
            ctx.stroke();
            ctx.setLineDash([]);
        } else {
            // No data
            ctx.fillStyle = '#333';
            ctx.font = '10px monospace';
            ctx.textAlign = 'center';
            ctx.fillText('No beacon data', w / 2, h / 2 + 3);
        }

        // Offset text overlay
        ctx.fillStyle = '#aaa';
        ctx.font = '9px monospace';
        ctx.textAlign = 'left';
        ctx.fillText(`${(beaconOffset || 0).toFixed(1)} Hz`, 3, 10);
        ctx.textAlign = 'right';
        ctx.fillText(`NCO: ${(beaconNcoCorrection || 0).toFixed(1)}`, w - 3, 10);

        // Lock indicator border
        ctx.strokeStyle = lockColor;
        ctx.lineWidth = 2;
        ctx.strokeRect(0, 0, w, h);
    }, [beaconSpectrum, beaconPeaks, beaconLockState, beaconOffset, beaconNcoCorrection, lockColor]);

    useEffect(() => {
        draw();
        const interval = setInterval(draw, 200);
        return () => clearInterval(interval);
    }, [draw]);

    return (
        <canvas
            ref={canvasRef}
            style={{
                width: '100%',
                height: SPECTRUM_HEIGHT,
                borderRadius: 4,
            }}
        />
    );
};

const BeaconLockAccordion = ({ expanded, onAccordionChange }) => {
    const {socket} = useSocket();
    const dispatch = useDispatch();
    const { beaconMarkers, centerFrequency, sampleRate, selectedSDRId } = useSelector(state => state.waterfall);
    const { beaconLockState, beaconOffset, beaconNcoCorrection, beaconPeaks } = useSelector(state => state.bitlink21);

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

    const handleStartLock = () => {
        if (!socket) return;
        const lowFreq = centerFrequency - markerSpread;
        const highFreq = centerFrequency + markerSpread;
        dispatch(setBeaconMarkers({ active: true, lowFreq, highFreq, lockState: 'TRACKING' }));
        socket.emit('data_submission', 'bitlink21:beacon_start', {
            beacon_freq_hz: rfToIF(centerFrequency),
            marker_low_hz: rfToIF(centerFrequency - markerSpread),
            marker_high_hz: rfToIF(centerFrequency + markerSpread),
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
                marker_low_hz: rfToIF(centerFrequency - value),
                marker_high_hz: rfToIF(centerFrequency + value),
                beacon_freq_hz: rfToIF(centerFrequency),
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
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                    {/* Marker spread control */}
                    <Box>
                        <Typography variant="caption" color="text.secondary">
                            Marker Spread: ±{markerSpread} Hz ({(markerSpread * 2 / 1000).toFixed(1)} kHz)
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

                    {/* Mini spectrum canvas — real FFT data from worker */}
                    {isRunning && <BeaconSpectrumCanvas />}

                    {/* Status when running */}
                    {isRunning && (
                        <>
                            <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                                <Typography variant="caption" color="text.secondary">Offset</Typography>
                                <Typography variant="body2" sx={{ fontFamily: 'monospace', fontWeight: 600 }}>
                                    {beaconOffset > 0 ? '+' : ''}{(beaconOffset || 0).toFixed(1)} Hz
                                </Typography>
                            </Box>
                            <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                                <Typography variant="caption" color="text.secondary">NCO Correction</Typography>
                                <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                                    {(beaconNcoCorrection || 0).toFixed(1)} Hz
                                </Typography>
                            </Box>
                            {beaconPeaks && beaconPeaks.length >= 2 && (
                                <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                                    <Typography variant="caption" color="text.secondary">Dual Tone</Typography>
                                    <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>
                                        {beaconPeaks[0].toFixed(0)} / {beaconPeaks[1].toFixed(0)} Hz
                                    </Typography>
                                </Box>
                            )}
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
