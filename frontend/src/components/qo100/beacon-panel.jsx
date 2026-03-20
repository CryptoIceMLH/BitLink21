import React, { useRef, useEffect, useCallback } from 'react';
import { useSelector } from 'react-redux';
import { Box, Typography, Paper, Chip, Button } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { useSocket } from '../common/socket.jsx';

const CANVAS_WIDTH = 400;
const CANVAS_HEIGHT = 120;

/**
 * Beacon Lock Panel — SDR Console style
 *
 * Shows a zoomed-in spectrum centered on the beacon frequency.
 * Green shaded area shows the tracking window.
 * Circular indicator shows lock quality.
 *
 * Data flow: PlutoSDR worker → data_queue → processlifecycle →
 *   Socket.IO "bitlink21:beacon_status" → Redux → this component
 */
export default function BeaconPanel() {
    const theme = useTheme();
    const {socket} = useSocket();
    const canvasRef = useRef(null);
    const {
        beaconLockState, beaconOffset, beaconPhaseError,
        beaconSpectrum, beaconXoCorrection
    } = useSelector(state => state.bitlink21);
    const { centerFrequency } = useSelector(state => state.waterfall);

    const lockColor = beaconLockState === 'LOCKED' ? '#4caf50' :
                      beaconLockState === 'TRACKING' ? '#ff9800' : '#f44336';

    const handleBeaconToggle = useCallback(() => {
        if (!socket) return;
        if (beaconLockState === 'UNLOCKED') {
            // Start beacon tracking — use center frequency as beacon freq
            socket.emit('data_submission', 'bitlink21:beacon_start', {
                beacon_freq_hz: centerFrequency || 0,
                marker_low_hz: (centerFrequency || 0) - 2500,
                marker_high_hz: (centerFrequency || 0) + 2500,
            });
        } else {
            socket.emit('data_submission', 'bitlink21:beacon_stop', {});
        }
    }, [socket, beaconLockState, centerFrequency]);

    const drawBeaconSpectrum = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const dpr = window.devicePixelRatio || 1;
        canvas.width = CANVAS_WIDTH * dpr;
        canvas.height = CANVAS_HEIGHT * dpr;
        ctx.scale(dpr, dpr);

        // Background
        ctx.fillStyle = '#0a1a0a';
        ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

        // Grid lines
        ctx.strokeStyle = '#1a2a1a';
        ctx.lineWidth = 0.5;
        for (let y = 0; y < CANVAS_HEIGHT; y += 20) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(CANVAS_WIDTH, y);
            ctx.stroke();
        }
        for (let x = 0; x < CANVAS_WIDTH; x += 40) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, CANVAS_HEIGHT);
            ctx.stroke();
        }

        // Draw spectrum — real data from backend if available, noise floor otherwise
        ctx.strokeStyle = lockColor;
        ctx.lineWidth = 1.5;
        ctx.beginPath();

        if (beaconSpectrum && beaconSpectrum.length > 0) {
            // Real FFT data from PlutoSDR worker beacon tracking
            const numBins = beaconSpectrum.length;
            const binWidth = CANVAS_WIDTH / numBins;

            // Find min/max for auto-scaling
            let minDb = Infinity, maxDb = -Infinity;
            for (let i = 0; i < numBins; i++) {
                const v = beaconSpectrum[i];
                if (v < minDb) minDb = v;
                if (v > maxDb) maxDb = v;
            }
            const rangeDb = Math.max(maxDb - minDb, 10);  // At least 10 dB range

            for (let i = 0; i < numBins; i++) {
                const x = i * binWidth;
                // Scale: top of canvas = maxDb, bottom = minDb
                const normalized = (beaconSpectrum[i] - minDb) / rangeDb;
                const y = CANVAS_HEIGHT - 10 - normalized * (CANVAS_HEIGHT - 20);
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
        } else {
            // No beacon data — draw noise floor
            const cx = CANVAS_WIDTH / 2;
            for (let x = 0; x < CANVAS_WIDTH; x++) {
                const noise = Math.random() * 3;
                const y = CANVAS_HEIGHT - 15 - noise;
                if (x === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
        }
        ctx.stroke();

        // Tracking window (green shaded)
        const windowWidth = 60;
        const cx = CANVAS_WIDTH / 2;
        ctx.fillStyle = `${lockColor}15`;
        ctx.fillRect(cx - windowWidth / 2, 0, windowWidth, CANVAS_HEIGHT);

        // Center marker
        ctx.strokeStyle = lockColor;
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(cx, 0);
        ctx.lineTo(cx, CANVAS_HEIGHT);
        ctx.stroke();
        ctx.setLineDash([]);

        // Lock indicator circle (top-right)
        const circleR = 15;
        const circleX = CANVAS_WIDTH - circleR - 10;
        const circleY = circleR + 10;
        ctx.beginPath();
        ctx.arc(circleX, circleY, circleR, 0, 2 * Math.PI);
        ctx.fillStyle = `${lockColor}33`;
        ctx.fill();
        ctx.strokeStyle = lockColor;
        ctx.lineWidth = 2;
        ctx.stroke();

        // Lock state text in circle
        ctx.fillStyle = lockColor;
        ctx.font = 'bold 8px monospace';
        ctx.textAlign = 'center';
        const stateText = beaconLockState === 'LOCKED' ? 'LOCK' :
                         beaconLockState === 'TRACKING' ? 'TRK' : 'OFF';
        ctx.fillText(stateText, circleX, circleY + 3);

        // Offset text
        ctx.fillStyle = '#aaa';
        ctx.font = '10px monospace';
        ctx.textAlign = 'left';
        ctx.fillText(`Offset: ${(beaconOffset || 0).toFixed(1)} Hz`, 5, CANVAS_HEIGHT - 5);

        // XO correction text
        ctx.fillText(`XO: ${beaconXoCorrection || 0} Hz`, 5, CANVAS_HEIGHT - 18);

        // Frequency label
        ctx.textAlign = 'right';
        if (centerFrequency) {
            ctx.fillText(`${(centerFrequency / 1e6).toFixed(3)} MHz`, CANVAS_WIDTH - 5, CANVAS_HEIGHT - 5);
        }
    }, [beaconLockState, beaconOffset, beaconXoCorrection, lockColor, centerFrequency, beaconSpectrum]);

    useEffect(() => {
        drawBeaconSpectrum();
        const interval = setInterval(drawBeaconSpectrum, 200); // 5 FPS
        return () => clearInterval(interval);
    }, [drawBeaconSpectrum]);

    return (
        <Paper sx={{
            p: 1, display: 'flex', flexDirection: 'column', gap: 0.5,
            backgroundColor: 'background.elevated',
        }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>
                    BEACON LOCK
                </Typography>
                <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
                    <Button
                        size="small"
                        variant={beaconLockState === 'UNLOCKED' ? 'outlined' : 'contained'}
                        onClick={handleBeaconToggle}
                        color={beaconLockState === 'LOCKED' ? 'success' : beaconLockState === 'TRACKING' ? 'warning' : 'primary'}
                        sx={{ minWidth: 50, fontSize: '0.6rem', py: 0.2 }}
                    >
                        {beaconLockState === 'UNLOCKED' ? 'Start' : 'Stop'}
                    </Button>
                    <Chip
                        label={beaconLockState || 'UNLOCKED'}
                        size="small"
                        sx={{
                            backgroundColor: `${lockColor}22`,
                            color: lockColor,
                            fontWeight: 700, fontSize: '0.65rem',
                        }}
                    />
                </Box>
            </Box>
            <canvas
                ref={canvasRef}
                style={{
                    width: '100%',
                    height: CANVAS_HEIGHT,
                    borderRadius: 4,
                    border: `1px solid ${theme.palette.divider}`,
                }}
            />
        </Paper>
    );
}
