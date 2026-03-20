/**
 * BitLink21 QO-100 Operations Page — SDR Console Style Layout
 *
 * Multi-panel layout:
 * ┌──────────────┬─────────────┬──────────────┐
 * │  RX Freq     │ Beacon Lock │  TX Freq     │
 * │  RX Controls │  Spectrum   │  TX Controls │
 * ├──────────────┴─────────────┴──────────────┤
 * │          Wide Spectrum + Waterfall         │
 * │  [Band Plan: CW|NB|SSB|CONTEST|PSK]      │
 * ├───────────────────────────────────────────┤
 * │ [RIT][XIT] | Filter | Constellation | Sync│
 * └───────────────────────────────────────────┘
 */

import React, { useRef, useEffect, useCallback } from 'react';
import { useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { Box, Typography, Paper, Chip, Divider } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { useSocket } from '../common/socket.jsx';
import MainWaterfallDisplay from '../waterfall/waterfall-island.jsx';

// Sub-panels
import RXPanel from './rx-panel.jsx';
import TXPanel from './tx-panel.jsx';
import BeaconPanel from './beacon-panel.jsx';

const FrequencyDisplay = ({ freq, label, color }) => (
    <Paper sx={{
        p: 1.5, textAlign: 'center',
        backgroundColor: 'background.elevated',
        border: `1px solid ${color}33`,
    }}>
        <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
            {label}
        </Typography>
        <Typography variant="h4" sx={{
            fontFamily: 'monospace', fontWeight: 700, color,
            letterSpacing: '-0.5px', lineHeight: 1.2,
        }}>
            {freq ? (freq / 1e6).toFixed(3) : '---'} <span style={{ fontSize: '0.5em' }}>MHz</span>
        </Typography>
    </Paper>
);

/**
 * Mini Constellation Diagram — renders IQ points on a canvas.
 * Data comes from Redux state (populated by Socket.IO beacon_status events).
 */
const ConstellationMini = ({ width = 36, height = 36 }) => {
    const canvasRef = useRef(null);
    const theme = useTheme();
    const { constellationPoints } = useSelector(state => state.bitlink21);

    const draw = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const dpr = window.devicePixelRatio || 1;
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        ctx.scale(dpr, dpr);

        // Background
        ctx.fillStyle = '#0a0a14';
        ctx.fillRect(0, 0, width, height);

        // Crosshair
        ctx.strokeStyle = '#222';
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(width / 2, 0); ctx.lineTo(width / 2, height);
        ctx.moveTo(0, height / 2); ctx.lineTo(width, height / 2);
        ctx.stroke();

        // Points
        if (constellationPoints && constellationPoints.length > 0) {
            ctx.fillStyle = '#4caf50';
            const scale = width / 4;  // ±2 on each axis
            for (const pt of constellationPoints) {
                const x = width / 2 + (pt.I || 0) * scale;
                const y = height / 2 - (pt.Q || 0) * scale;
                ctx.beginPath();
                ctx.arc(x, y, 1, 0, 2 * Math.PI);
                ctx.fill();
            }
        } else {
            // No data indicator
            ctx.fillStyle = '#444';
            ctx.font = '8px monospace';
            ctx.textAlign = 'center';
            ctx.fillText('IQ', width / 2, height / 2 + 3);
        }
    }, [constellationPoints, width, height]);

    useEffect(() => {
        draw();
        const interval = setInterval(draw, 200);
        return () => clearInterval(interval);
    }, [draw]);

    return (
        <canvas
            ref={canvasRef}
            style={{
                width, height,
                borderRadius: 2,
                border: `1px solid ${theme.palette.divider}`,
            }}
        />
    );
};

export default function QO100Layout() {
    const theme = useTheme();
    const { t } = useTranslation('bitlink21');
    const {socket} = useSocket();

    const { centerFrequency, sampleRate, isStreaming } = useSelector(state => state.waterfall);
    const { pttActive, txFreq, beaconLockState, beaconOffset } = useSelector(state => state.bitlink21);

    // Refs for waterfall playback (not used in QO-100 mode)
    const playbackElapsedRef = useRef({ current: 0 });
    const playbackRemainingRef = useRef({ current: 0 });
    const playbackTotalRef = useRef({ current: 0 });

    // RIT/XIT — send offsets to PlutoSDR worker config_queue
    const handleRitToggle = useCallback(() => {
        if (!socket) return;
        // RIT shifts RX frequency relative to TX by a small offset
        // Implemented via fine VFO offset on the backend
        socket.emit('data_submission', 'bitlink21:set_config', {
            key: 'rit_enabled', value: 'toggle',
        });
    }, [socket]);

    const handleXitToggle = useCallback(() => {
        if (!socket) return;
        socket.emit('data_submission', 'bitlink21:set_config', {
            key: 'xit_enabled', value: 'toggle',
        });
    }, [socket]);

    return (
        <Box sx={{
            display: 'flex', flexDirection: 'column', height: '100vh',
            backgroundColor: theme.palette.background.default,
            overflow: 'hidden',
        }}>
            {/* TOP ROW: RX Freq | Beacon | TX Freq */}
            <Box sx={{
                display: 'grid',
                gridTemplateColumns: '1fr 1.5fr 1fr',
                gap: 1, p: 1,
                minHeight: '200px',
            }}>
                {/* RX Side */}
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    <FrequencyDisplay
                        freq={centerFrequency}
                        label="RX"
                        color="#4caf50"
                    />
                    <RXPanel />
                </Box>

                {/* Beacon Lock Center */}
                <BeaconPanel />

                {/* TX Side */}
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    <FrequencyDisplay
                        freq={txFreq || centerFrequency}
                        label="TX"
                        color="#f44336"
                    />
                    <TXPanel />
                </Box>
            </Box>

            {/* WIDE SPECTRUM + WATERFALL */}
            <Box sx={{ flex: 1, position: 'relative', minHeight: 0, overflow: 'hidden' }}>
                <MainWaterfallDisplay
                    playbackElapsedSecondsRef={playbackElapsedRef}
                    playbackRemainingSecondsRef={playbackRemainingRef}
                    playbackTotalSecondsRef={playbackTotalRef}
                />
            </Box>

            {/* BOTTOM BAR: Controls + Status */}
            <Box sx={{
                display: 'flex', alignItems: 'center', gap: 2,
                p: 1, backgroundColor: theme.palette.background.paper,
                borderTop: `1px solid ${theme.palette.divider}`,
                minHeight: '40px',
            }}>
                {/* RIT/XIT */}
                <Chip label="RIT" size="small" variant="outlined" onClick={handleRitToggle}
                      sx={{ cursor: 'pointer' }} />
                <Chip label="XIT" size="small" variant="outlined" onClick={handleXitToggle}
                      sx={{ cursor: 'pointer' }} />
                <Divider orientation="vertical" flexItem />

                {/* Filter */}
                <Chip label={`Filter: 3.6 kHz`} size="small" color="primary" variant="outlined" />
                <Divider orientation="vertical" flexItem />

                {/* Constellation diagram — real IQ data from GNU Radio */}
                <ConstellationMini width={36} height={36} />
                <Divider orientation="vertical" flexItem />

                {/* Status indicators */}
                <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                    <Chip
                        label="RX Sync"
                        size="small"
                        color={isStreaming ? 'success' : 'default'}
                        sx={{ '& .MuiChip-label': { fontSize: '0.7rem' } }}
                    />
                    <Chip
                        label="Signal"
                        size="small"
                        color={isStreaming ? 'success' : 'default'}
                        sx={{ '& .MuiChip-label': { fontSize: '0.7rem' } }}
                    />
                    <Chip
                        label={beaconLockState || 'UNLOCKED'}
                        size="small"
                        color={beaconLockState === 'LOCKED' ? 'success' : beaconLockState === 'TRACKING' ? 'warning' : 'error'}
                        sx={{ '& .MuiChip-label': { fontSize: '0.7rem' } }}
                    />
                </Box>

                <Box sx={{ flex: 1 }} />

                {/* Beacon offset */}
                {beaconOffset !== 0 && (
                    <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
                        AFC: {beaconOffset > 0 ? '+' : ''}{beaconOffset.toFixed(1)} Hz
                    </Typography>
                )}

                {/* PTT indicator */}
                {pttActive && (
                    <Chip label="TX" color="error" size="small" sx={{
                        animation: 'pulse 1s infinite',
                        '@keyframes pulse': { '0%, 100%': { opacity: 1 }, '50%': { opacity: 0.5 } }
                    }} />
                )}

                {/* Sample rate */}
                <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
                    sr: {sampleRate ? `${(sampleRate / 1e6).toFixed(1)} MHz` : '—'}
                </Typography>
            </Box>
        </Box>
    );
}
