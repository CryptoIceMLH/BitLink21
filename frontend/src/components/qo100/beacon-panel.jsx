import React, { useRef, useEffect, useCallback } from 'react';
import { useSelector } from 'react-redux';
import { Box, Typography, Paper, Chip } from '@mui/material';
import { useTheme } from '@mui/material/styles';

const CANVAS_WIDTH = 400;
const CANVAS_HEIGHT = 120;

/**
 * Beacon Lock Panel — SDR Console style
 *
 * Shows a zoomed-in spectrum centered on the beacon frequency.
 * Green shaded area shows the tracking window.
 * Circular indicator shows lock quality.
 */
export default function BeaconPanel() {
    const theme = useTheme();
    const canvasRef = useRef(null);
    const { beaconLockState, beaconOffset, beaconPhaseError } = useSelector(state => state.bitlink21);
    const { centerFrequency } = useSelector(state => state.waterfall);

    const lockColor = beaconLockState === 'LOCKED' ? '#4caf50' :
                      beaconLockState === 'TRACKING' ? '#ff9800' : '#f44336';

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

        // Simulated beacon spectrum (placeholder — will be fed from GNU Radio FFT)
        ctx.strokeStyle = lockColor;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        const cx = CANVAS_WIDTH / 2;
        for (let x = 0; x < CANVAS_WIDTH; x++) {
            const dist = Math.abs(x - cx);
            const noise = Math.random() * 5;
            const signal = dist < 20 ? 80 - dist * 2 : 0;
            const y = CANVAS_HEIGHT - 10 - noise - signal;
            if (x === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.stroke();

        // Tracking window (green shaded)
        const windowWidth = 60;
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

        // Frequency label
        ctx.textAlign = 'right';
        if (centerFrequency) {
            ctx.fillText(`${(centerFrequency / 1e6).toFixed(3)} MHz`, CANVAS_WIDTH - 5, CANVAS_HEIGHT - 5);
        }
    }, [beaconLockState, beaconOffset, lockColor, centerFrequency]);

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
