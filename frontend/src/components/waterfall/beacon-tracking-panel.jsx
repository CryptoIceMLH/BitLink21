/**
 * Beacon Tracking Panel — Dedicated beacon lock display (SDR Console style)
 *
 * Renders above the main waterfall when beacon tracking is active.
 * Contains: mini spectrum canvas, lock indicator, frequency readout,
 * drift display, and control buttons.
 *
 * All correction happens server-side (VFO frequency shift).
 * This panel is display + controls only.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Box, Typography, Button, Chip, TextField, InputAdornment } from '@mui/material';
import LockIcon from '@mui/icons-material/Lock';
import LockOpenIcon from '@mui/icons-material/LockOpen';
import { useSocket } from '../common/socket.jsx';

const SPECTRUM_WIDTH = 350;
const SPECTRUM_HEIGHT = 70;

const BeaconTrackingPanel = () => {
    const { socket } = useSocket();
    const dispatch = useDispatch();
    const canvasRef = useRef(null);

    const { centerFrequency } = useSelector(state => state.waterfall);
    const { beaconMeasuring, beaconCorrecting, beaconOffset, beaconSpectrum } =
        useSelector(state => state.bitlink21);

    const [beaconFreq, setBeaconFreq] = useState(centerFrequency || 0);
    const [markerSpread, setMarkerSpread] = useState(500);

    // Update beaconFreq from center frequency when not yet positioned
    useEffect(() => {
        if (!beaconMeasuring && centerFrequency) setBeaconFreq(centerFrequency);
    }, [centerFrequency, beaconMeasuring]);

    // Controls — send frequencies in RF space (same as worker's center_freq)
    // No RF→IF conversion — the worker FFT operates in RF space
    const handleSetBeacon = useCallback(() => {
        if (!socket) return;
        socket.emit('data_submission', 'bitlink21:beacon_set_position', {
            beacon_freq_hz: beaconFreq,
            marker_low_hz: beaconFreq - markerSpread,
            marker_high_hz: beaconFreq + markerSpread,
        });
    }, [socket, beaconFreq, markerSpread]);

    const handleLock = useCallback(() => {
        if (!socket) return;
        socket.emit('data_submission', 'bitlink21:beacon_lock', {});
    }, [socket]);

    const handleUnlock = useCallback(() => {
        if (!socket) return;
        socket.emit('data_submission', 'bitlink21:beacon_unlock', {});
    }, [socket]);

    const handleStop = useCallback(() => {
        if (!socket) return;
        socket.emit('data_submission', 'bitlink21:beacon_stop', {});
    }, [socket]);

    // Lock indicator color
    const lockColor = beaconCorrecting ? '#4caf50' : beaconMeasuring ? '#ff9800' : '#666';

    // Draw mini spectrum
    const drawSpectrum = useCallback(() => {
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

            // Spectrum line (green)
            ctx.strokeStyle = '#4caf50';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            for (let i = 0; i < numBins; i++) {
                const x = i * binWidth;
                const normalized = (beaconSpectrum[i] - minDb) / rangeDb;
                const y = h - 4 - normalized * (h - 8);
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.stroke();

            // Fill under spectrum (subtle green)
            ctx.lineTo(w, h);
            ctx.lineTo(0, h);
            ctx.closePath();
            ctx.fillStyle = 'rgba(76, 175, 80, 0.1)';
            ctx.fill();
        } else {
            ctx.fillStyle = '#333';
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
    }, [beaconSpectrum, lockColor]);

    useEffect(() => {
        drawSpectrum();
        const interval = setInterval(drawSpectrum, 200);
        return () => clearInterval(interval);
    }, [drawSpectrum]);

    return (
        <Box sx={{
            display: 'flex', alignItems: 'center', gap: 1.5,
            px: 1, py: 0.5,
            backgroundColor: '#0d1117',
            borderBottom: `2px solid ${lockColor}`,
            minHeight: 80,
        }}>
            {/* Mini spectrum canvas */}
            <canvas
                ref={canvasRef}
                style={{
                    width: SPECTRUM_WIDTH,
                    height: SPECTRUM_HEIGHT,
                    borderRadius: 4,
                    flexShrink: 0,
                }}
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
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.3, minWidth: 120 }}>
                <Typography variant="caption" sx={{ color: lockColor, fontWeight: 700, fontSize: '0.7rem' }}>
                    {beaconCorrecting ? 'LOCKED' : beaconMeasuring ? 'MEASURING' : 'BEACON'}
                </Typography>
                <Typography variant="body2" sx={{ fontFamily: 'monospace', fontWeight: 600, color: '#fff', fontSize: '0.85rem' }}>
                    {(beaconFreq / 1e6).toFixed(6)} MHz
                </Typography>
                <Typography variant="caption" sx={{ fontFamily: 'monospace', color: '#aaa' }}>
                    Drift: {beaconOffset > 0 ? '+' : ''}{(beaconOffset || 0).toFixed(1)} Hz
                    {beaconCorrecting && <span style={{ color: '#4caf50', marginLeft: 4 }}>(corr)</span>}
                </Typography>
            </Box>

            {/* Beacon frequency input */}
            <TextField
                size="small"
                value={(beaconFreq / 1e6).toFixed(6)}
                onChange={e => {
                    const mhz = parseFloat(e.target.value);
                    if (!isNaN(mhz)) setBeaconFreq(mhz * 1e6);
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
};

export default BeaconTrackingPanel;
