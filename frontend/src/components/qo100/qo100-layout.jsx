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
 * │          Narrow Spectrum (VFO zoom)       │
 * ├───────────────────────────────────────────┤
 * │ [RIT][XIT] | Filter | Constellation | Sync│
 * └───────────────────────────────────────────┘
 */

import React, { useState, useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { Box, Typography, Paper, Chip, Divider } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { useSocket } from '../common/socket.jsx';

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

export default function QO100Layout() {
    const theme = useTheme();
    const { t } = useTranslation('bitlink21');
    const dispatch = useDispatch();
    const {socket} = useSocket();

    const { centerFrequency, sampleRate, isStreaming, selectedSDRId } = useSelector(state => state.waterfall);
    const { pttActive, txFreq, beaconLockState, beaconOffset } = useSelector(state => state.bitlink21);

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
            <Box sx={{ flex: 1, position: 'relative', minHeight: 0 }}>
                {/* TODO: Embed the existing WaterfallAndBandscope component here */}
                <Box sx={{
                    width: '100%', height: '100%',
                    backgroundColor: '#0a0a1a',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    border: `1px solid ${theme.palette.divider}`,
                }}>
                    <Typography color="text.secondary" sx={{ fontStyle: 'italic' }}>
                        {isStreaming ? 'Waterfall renders here (integration pending)' : 'Start SDR streaming to see waterfall'}
                    </Typography>
                </Box>
            </Box>

            {/* BOTTOM BAR: Controls + Status */}
            <Box sx={{
                display: 'flex', alignItems: 'center', gap: 2,
                p: 1, backgroundColor: theme.palette.background.paper,
                borderTop: `1px solid ${theme.palette.divider}`,
                minHeight: '40px',
            }}>
                {/* RIT/XIT */}
                <Chip label="RIT" size="small" variant="outlined" />
                <Chip label="XIT" size="small" variant="outlined" />
                <Divider orientation="vertical" flexItem />

                {/* Filter */}
                <Chip label={`Filter: 3.6 kHz`} size="small" color="primary" variant="outlined" />
                <Divider orientation="vertical" flexItem />

                {/* Constellation placeholder */}
                <Box sx={{
                    width: 80, height: 30,
                    border: `1px solid ${theme.palette.divider}`,
                    borderRadius: 1,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                    <Typography variant="caption" color="text.secondary">IQ</Typography>
                </Box>
                <Divider orientation="vertical" flexItem />

                {/* Status indicators */}
                <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                    <Chip
                        label={`RX Sync`}
                        size="small"
                        color={isStreaming ? 'success' : 'default'}
                        sx={{ '& .MuiChip-label': { fontSize: '0.7rem' } }}
                    />
                    <Chip
                        label={`Signal`}
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

                {/* PTT indicator */}
                {pttActive && (
                    <Chip label="TX" color="error" size="small" sx={{
                        animation: 'pulse 1s infinite',
                        '@keyframes pulse': { '0%, 100%': { opacity: 1 }, '50%': { opacity: 0.5 } }
                    }} />
                )}

                {/* FPS counter */}
                <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
                    sr: {sampleRate ? `${(sampleRate / 1e6).toFixed(1)} MHz` : '—'}
                </Typography>
            </Box>
        </Box>
    );
}
