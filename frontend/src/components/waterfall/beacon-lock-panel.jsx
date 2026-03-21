/**
 * Beacon Lock Panel — Unified beacon lock UI
 *
 * Supports two modes:
 *   mode="panel"     → Horizontal bar above waterfall (SDR Console style)
 *   mode="accordion"  → Sidebar accordion with advanced controls
 *
 * All correction happens server-side (VFO frequency shift).
 * This component is display + controls only.
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
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

const SPECTRUM_WIDTH = 400;
const SPECTRUM_HEIGHT = 80;

// ─────────────────────────────────────────────────────────────
// Mini spectrum canvas with draggable marker lines
// ─────────────────────────────────────────────────────────────
const BeaconSpectrumCanvas = ({ spectrum, lockColor, markerSpread, freqRes, onMarkerDrag }) => {
    const canvasRef = useRef(null);
    const draggingRef = useRef(null); // 'left' | 'right' | null
    const spreadRef = useRef(markerSpread);
    spreadRef.current = markerSpread;

    const draw = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const dpr = window.devicePixelRatio || 1;
        const w = SPECTRUM_WIDTH;
        const h = SPECTRUM_HEIGHT;
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        ctx.scale(dpr, dpr);

        // Dark background
        ctx.fillStyle = '#0a140a';
        ctx.fillRect(0, 0, w, h);

        // Grid
        ctx.strokeStyle = '#1a2a1a';
        ctx.lineWidth = 0.5;
        for (let y = 0; y < h; y += 14) {
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
        }
        for (let x = 0; x < w; x += w / 8) {
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
        }

        if (spectrum && spectrum.length > 0) {
            const numBins = spectrum.length;
            const binWidth = w / numBins;

            // Auto-scale
            let minDb = Infinity, maxDb = -Infinity;
            for (const v of spectrum) {
                if (v < minDb) minDb = v;
                if (v > maxDb) maxDb = v;
            }
            const rangeDb = Math.max(maxDb - minDb, 10);

            // Spectrum line (green)
            ctx.strokeStyle = '#4caf50';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            for (let i = 0; i < numBins; i++) {
                const x = i * binWidth;
                const normalized = (spectrum[i] - minDb) / rangeDb;
                const y = h - 4 - normalized * (h - 8);
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.stroke();

            // Fill under spectrum
            ctx.lineTo(w, h);
            ctx.lineTo(0, h);
            ctx.closePath();
            ctx.fillStyle = 'rgba(76, 175, 80, 0.1)';
            ctx.fill();

            // Draw marker lines (orange) — position based on marker spread vs FFT width
            if (freqRes > 0 && numBins > 0) {
                const totalBandwidth = freqRes * numBins;
                const spreadBins = spreadRef.current / freqRes;
                const centerBin = numBins / 2;
                const leftX = ((centerBin - spreadBins) / numBins) * w;
                const rightX = ((centerBin + spreadBins) / numBins) * w;

                ctx.strokeStyle = '#ff9800';
                ctx.lineWidth = 2;
                ctx.setLineDash([]);

                // Left marker
                ctx.beginPath();
                ctx.moveTo(leftX, 0);
                ctx.lineTo(leftX, h);
                ctx.stroke();

                // Right marker
                ctx.beginPath();
                ctx.moveTo(rightX, 0);
                ctx.lineTo(rightX, h);
                ctx.stroke();

                // Marker tabs (grab handles at top)
                ctx.fillStyle = '#ff9800';
                ctx.fillRect(leftX - 5, 0, 10, 8);
                ctx.fillRect(rightX - 5, 0, 10, 8);
            }
        } else {
            ctx.fillStyle = '#555';
            ctx.font = '11px monospace';
            ctx.textAlign = 'center';
            ctx.fillText('Waiting for beacon data...', w / 2, h / 2 + 4);
        }

        // Center marker (expected beacon position)
        ctx.strokeStyle = '#ffffff44';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(w / 2, 0);
        ctx.lineTo(w / 2, h);
        ctx.stroke();
        ctx.setLineDash([]);

        // Lock status border
        ctx.strokeStyle = lockColor;
        ctx.lineWidth = 2;
        ctx.strokeRect(0, 0, w, h);
    }, [spectrum, lockColor, freqRes]);

    useEffect(() => {
        draw();
        const interval = setInterval(draw, 200);
        return () => clearInterval(interval);
    }, [draw]);

    // Mouse handlers for dragging markers
    const handleMouseDown = useCallback((e) => {
        if (!spectrum || spectrum.length === 0 || !freqRes) return;
        const canvas = canvasRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const numBins = spectrum.length;
        const centerBin = numBins / 2;
        const spreadBins = spreadRef.current / freqRes;
        const leftX = ((centerBin - spreadBins) / numBins) * SPECTRUM_WIDTH;
        const rightX = ((centerBin + spreadBins) / numBins) * SPECTRUM_WIDTH;

        if (Math.abs(x - leftX) < 12) draggingRef.current = 'left';
        else if (Math.abs(x - rightX) < 12) draggingRef.current = 'right';
    }, [spectrum, freqRes]);

    const handleMouseMove = useCallback((e) => {
        if (!draggingRef.current || !spectrum || !freqRes) return;
        const canvas = canvasRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const numBins = spectrum.length;
        const centerBin = numBins / 2;
        const binAtX = (x / SPECTRUM_WIDTH) * numBins;
        const newSpreadBins = Math.abs(binAtX - centerBin);
        const newSpreadHz = Math.max(100, Math.round(newSpreadBins * freqRes));
        if (onMarkerDrag) onMarkerDrag(newSpreadHz);
    }, [spectrum, freqRes, onMarkerDrag]);

    const handleMouseUp = useCallback(() => {
        draggingRef.current = null;
    }, []);

    return (
        <canvas
            ref={canvasRef}
            style={{
                width: SPECTRUM_WIDTH,
                height: SPECTRUM_HEIGHT,
                borderRadius: 4,
                flexShrink: 0,
                cursor: draggingRef.current ? 'ew-resize' : 'default',
            }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
        />
    );
};

// ─────────────────────────────────────────────────────────────
// Main BeaconLockPanel component
// ─────────────────────────────────────────────────────────────
const BeaconLockPanel = ({ mode = 'accordion', expanded, onAccordionChange }) => {
    const { socket } = useSocket();
    const dispatch = useDispatch();
    const { beaconMarkers, centerFrequency, selectedSDRId } = useSelector(state => state.waterfall);
    const { beaconMeasuring, beaconCorrecting, beaconOffset, beaconSpectrum, beaconSnr } =
        useSelector(state => state.bitlink21);

    const [xoCorrection, setXoCorrection] = useState(0);
    const [markerSpread, setMarkerSpread] = useState(500);
    const [beaconFreq, setBeaconFreq] = useState(centerFrequency || 0);
    const [freqRes, setFreqRes] = useState(5); // Hz per bin

    const isPositioned = beaconMarkers?.active || false;

    // Converter for RF→IF
    const { converterDefinitions, activeConverterId } = useSelector(state => state.waterfall);
    const activeConverter = converterDefinitions?.find(c => c.id === activeConverterId);
    const rfToIF = useCallback((freq) => {
        if (!activeConverter || activeConverter.type === 'none') return freq;
        if (activeConverter.type === 'down') return freq - activeConverter.rxOffset;
        if (activeConverter.type === 'up') return freq + activeConverter.rxOffset;
        return freq;
    }, [activeConverter]);

    // Update beaconFreq when center frequency changes (before positioning)
    useEffect(() => {
        if (!isPositioned && centerFrequency) setBeaconFreq(centerFrequency);
    }, [centerFrequency, isPositioned]);

    // Update freqRes from backend beacon_status
    const beaconFreqRes = useSelector(state => state.bitlink21.beaconFreqRes);
    useEffect(() => {
        if (beaconFreqRes && beaconFreqRes > 0) setFreqRes(beaconFreqRes);
    }, [beaconFreqRes]);

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

    // Step 1: "Set Beacon"
    const handleSetBeacon = useCallback(() => {
        if (!socket) return;
        const lowFreq = beaconFreq - markerSpread;
        const highFreq = beaconFreq + markerSpread;
        dispatch(setBeaconMarkers({ active: true, lowFreq, highFreq, lockState: 'TRACKING' }));
        socket.emit('data_submission', 'bitlink21:beacon_set_position', {
            beacon_freq_hz: rfToIF(beaconFreq),
            marker_low_hz: rfToIF(lowFreq),
            marker_high_hz: rfToIF(highFreq),
        });
    }, [socket, beaconFreq, markerSpread, dispatch, rfToIF]);

    // Step 2: "Lock"
    const handleLock = useCallback(() => {
        if (!socket) return;
        dispatch(setBeaconMarkers({ lockState: 'LOCKED' }));
        socket.emit('data_submission', 'bitlink21:beacon_lock', {});
    }, [socket, dispatch]);

    const handleUnlock = useCallback(() => {
        if (!socket) return;
        dispatch(setBeaconMarkers({ lockState: 'TRACKING' }));
        socket.emit('data_submission', 'bitlink21:beacon_unlock', {});
    }, [socket, dispatch]);

    const handleStop = useCallback(() => {
        if (!socket) return;
        dispatch(setBeaconMarkers({ active: false, lockState: 'UNLOCKED', offsetHz: 0 }));
        socket.emit('data_submission', 'bitlink21:beacon_stop', {});
    }, [socket, dispatch]);

    // Marker spread change (from slider or canvas drag)
    const handleMarkerSpreadChange = useCallback((newSpread) => {
        setMarkerSpread(newSpread);
        if (isPositioned && !beaconCorrecting && socket) {
            const lowFreq = beaconFreq - newSpread;
            const highFreq = beaconFreq + newSpread;
            dispatch(setBeaconMarkers({ lowFreq, highFreq }));
            socket.emit('data_submission', 'bitlink21:beacon_config', {
                marker_low_hz: rfToIF(lowFreq),
                marker_high_hz: rfToIF(highFreq),
                beacon_freq_hz: rfToIF(beaconFreq),
            });
        }
    }, [isPositioned, beaconCorrecting, socket, beaconFreq, dispatch, rfToIF]);

    const handleManualXO = useCallback(() => {
        if (!socket || !selectedSDRId || selectedSDRId === 'none') return;
        socket.emit('sdr_data', 'configure-sdr', {
            selectedSDRId,
            xo_correction: parseInt(xoCorrection),
        });
    }, [socket, selectedSDRId, xoCorrection]);

    // Sync marker lockState from backend
    useEffect(() => {
        if (beaconMarkers?.active) {
            const newState = beaconCorrecting ? 'LOCKED' : beaconMeasuring ? 'TRACKING' : 'UNLOCKED';
            dispatch(setBeaconMarkers({ lockState: newState, offsetHz: beaconOffset || 0 }));
        }
    }, [beaconMeasuring, beaconCorrecting, beaconOffset, dispatch, beaconMarkers?.active]);

    const lockColor = beaconCorrecting ? '#4caf50' : beaconMeasuring ? '#ff9800' : '#666';
    const statusText = beaconCorrecting ? 'LOCKED' : beaconMeasuring ? 'MEASURING' : 'BEACON';

    // ── Panel mode (above waterfall) ──────────────────────────
    if (mode === 'panel') {
        return (
            <Box sx={{
                display: 'flex', alignItems: 'center', gap: 1.5,
                px: 1, py: 0.5,
                backgroundColor: '#0d1117',
                borderBottom: `2px solid ${lockColor}`,
                minHeight: 90,
            }}>
                {/* Mini spectrum canvas */}
                <BeaconSpectrumCanvas
                    spectrum={beaconSpectrum}
                    lockColor={lockColor}
                    markerSpread={markerSpread}
                    freqRes={freqRes}
                    onMarkerDrag={handleMarkerSpreadChange}
                />

                {/* Lock indicator circle */}
                <Box sx={{
                    width: 40, height: 40, borderRadius: '50%',
                    border: `3px solid ${lockColor}`,
                    backgroundColor: `${lockColor}22`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0,
                }}>
                    {beaconCorrecting
                        ? <LockIcon sx={{ color: lockColor, fontSize: 20 }} />
                        : <LockOpenIcon sx={{ color: lockColor, fontSize: 20 }} />}
                </Box>

                {/* Info column */}
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.3, minWidth: 130 }}>
                    <Typography variant="caption" sx={{ color: lockColor, fontWeight: 700, fontSize: '0.7rem' }}>
                        {statusText}
                    </Typography>
                    <Typography variant="body2" sx={{ fontFamily: 'monospace', fontWeight: 600, color: '#fff', fontSize: '0.85rem' }}>
                        {(beaconFreq / 1e6).toFixed(6)} MHz
                    </Typography>
                    <Typography variant="caption" sx={{ fontFamily: 'monospace', color: '#aaa' }}>
                        Drift: {beaconOffset > 0 ? '+' : ''}{(beaconOffset || 0).toFixed(1)} Hz
                        {beaconCorrecting && <span style={{ color: '#4caf50', marginLeft: 4 }}>(corr)</span>}
                    </Typography>
                    {beaconSnr > 0 && (
                        <Typography variant="caption" sx={{ fontFamily: 'monospace', color: '#888', fontSize: '0.65rem' }}>
                            SNR: {beaconSnr.toFixed(1)} dB
                        </Typography>
                    )}
                </Box>

                {/* Beacon frequency input */}
                <TextField
                    size="small"
                    value={(beaconFreq / 1e6).toFixed(6)}
                    onChange={e => {
                        const mhz = parseFloat(e.target.value);
                        if (!isNaN(mhz)) handleBeaconFreqChange(mhz * 1e6);
                    }}
                    type="number"
                    disabled={beaconCorrecting}
                    InputProps={{
                        endAdornment: <InputAdornment position="end">MHz</InputAdornment>,
                        sx: { fontFamily: 'monospace', fontSize: '0.8rem', color: '#fff' },
                        inputProps: { step: 0.000001 },
                    }}
                    sx={{ width: 180, flexShrink: 0,
                        '& .MuiOutlinedInput-root': { backgroundColor: '#1a1a2e' },
                    }}
                />

                {/* Control buttons */}
                <Box sx={{ display: 'flex', gap: 0.5, flexShrink: 0 }}>
                    {!beaconMeasuring ? (
                        <Button variant="contained" size="small" onClick={handleSetBeacon}
                            sx={{ fontSize: '0.7rem', py: 0.5 }}>
                            Set Beacon
                        </Button>
                    ) : (
                        <>
                            {!beaconCorrecting ? (
                                <Button variant="contained" size="small" color="success" onClick={handleLock}
                                    sx={{ fontSize: '0.7rem', py: 0.5 }}>
                                    Lock
                                </Button>
                            ) : (
                                <Button variant="contained" size="small" color="warning" onClick={handleUnlock}
                                    sx={{ fontSize: '0.7rem', py: 0.5 }}>
                                    Unlock
                                </Button>
                            )}
                            <Button variant="outlined" size="small" color="error" onClick={handleStop}
                                sx={{ fontSize: '0.7rem', py: 0.5 }}>
                                Stop
                            </Button>
                        </>
                    )}
                </Box>
            </Box>
        );
    }

    // ── Accordion mode (sidebar) ──────────────────────────────
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
                        color={beaconCorrecting ? 'success' : beaconMeasuring ? 'warning' : 'default'}
                        size="small"
                        sx={{ ml: 'auto', mr: 1 }}
                    />
                </Box>
            </AccordionSummary>
            <AccordionDetails>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>

                    {/* Mini spectrum in accordion too */}
                    <BeaconSpectrumCanvas
                        spectrum={beaconSpectrum}
                        lockColor={lockColor}
                        markerSpread={markerSpread}
                        freqRes={freqRes}
                        onMarkerDrag={handleMarkerSpreadChange}
                    />

                    {/* Beacon frequency input */}
                    <Box>
                        <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
                            Beacon Frequency
                        </Typography>
                        <TextField
                            size="small"
                            fullWidth
                            value={(beaconFreq / 1e6).toFixed(6)}
                            onChange={e => {
                                const mhz = parseFloat(e.target.value);
                                if (!isNaN(mhz)) handleBeaconFreqChange(mhz * 1e6);
                            }}
                            type="number"
                            disabled={beaconCorrecting}
                            InputProps={{
                                endAdornment: <InputAdornment position="end">MHz</InputAdornment>,
                                sx: { fontFamily: 'monospace', fontSize: '0.9rem' },
                                inputProps: { step: 0.000001 },
                            }}
                        />
                    </Box>

                    {/* Marker spread */}
                    {!beaconCorrecting && (
                        <Box>
                            <Typography variant="caption" color="text.secondary">
                                Marker Spread: ±{markerSpread} Hz ({(markerSpread * 2 / 1000).toFixed(1)} kHz)
                            </Typography>
                            <Slider
                                value={markerSpread}
                                onChange={(_, value) => handleMarkerSpreadChange(value)}
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

                    {/* Drift display */}
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
                            {beaconSnr > 0 && (
                                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <Typography variant="caption" color="text.secondary">SNR</Typography>
                                    <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                                        {beaconSnr.toFixed(1)} dB
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

export default BeaconLockPanel;
