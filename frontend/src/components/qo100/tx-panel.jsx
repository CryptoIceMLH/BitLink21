import React, { useState, useCallback, useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
    Box, Typography, Paper, Button, Slider,
} from '@mui/material';
import { useSocket } from '../common/socket.jsx';
import { setPttActive, setTxGain } from '../bitlink21/bitlink21-slice.jsx';

export default function TXPanel() {
    const dispatch = useDispatch();
    const {socket} = useSocket();
    const { pttActive, txGain } = useSelector(state => state.bitlink21);
    const [toneActive, setToneActive] = useState(false);

    const handlePtt = useCallback(() => {
        const newState = !pttActive;
        dispatch(setPttActive(newState));
        if (socket) {
            socket.emit('data_submission', newState ? 'bitlink21:ptt_on' : 'bitlink21:ptt_off', {});
        }
    }, [socket, pttActive, dispatch]);

    const handleGainChange = useCallback((_, value) => {
        dispatch(setTxGain(value));
    }, [dispatch]);

    // Send TX gain to backend when it changes (debounced via useEffect)
    useEffect(() => {
        if (!socket) return;
        const timer = setTimeout(() => {
            // Send gain to PlutoSDR worker via config_queue
            socket.emit('data_submission', 'bitlink21:set_config', {
                key: 'tx_gain_db', value: String(txGain),
            });
            // Also update the running SDR if streaming
            socket.emit('sdr_config_update', { tx_gain: txGain });
        }, 200);
        return () => clearTimeout(timer);
    }, [txGain, socket]);

    const handleTestTone = useCallback(() => {
        if (!socket) return;
        if (toneActive) {
            socket.emit('data_submission', 'bitlink21:test_tone_stop', {});
            setToneActive(false);
        } else {
            socket.emit('data_submission', 'bitlink21:test_tone_start', {
                tone_freq_hz: 1000, tx_gain_db: txGain,
            });
            setToneActive(true);
        }
    }, [socket, toneActive, txGain]);

    return (
        <Paper sx={{ p: 1.5, flex: 1, overflow: 'auto' }}>
            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700, mb: 1, display: 'block' }}>
                TX CONTROLS
            </Typography>

            {/* PTT Button */}
            <Button
                variant="contained"
                fullWidth
                onClick={handlePtt}
                sx={{
                    py: 1.5, mb: 1, fontSize: '1rem', fontWeight: 700,
                    backgroundColor: pttActive ? '#d32f2f' : '#388e3c',
                    '&:hover': { backgroundColor: pttActive ? '#b71c1c' : '#2e7d32' },
                }}
            >
                {pttActive ? 'TX ON' : 'PTT'}
            </Button>

            {/* TX Power */}
            <Typography variant="caption" color="text.secondary">
                TX Power: {txGain} dB
            </Typography>
            <Slider
                value={txGain}
                onChange={handleGainChange}
                min={-89.75} max={0} step={0.25}
                size="small"
                sx={{ mb: 1 }}
            />

            {/* Test Tone */}
            <Button
                variant="outlined"
                fullWidth
                size="small"
                onClick={handleTestTone}
                color={toneActive ? 'error' : 'primary'}
                sx={{ mb: 1, fontSize: '0.75rem' }}
            >
                {toneActive ? 'Stop Tone' : 'Test Tone (1 kHz)'}
            </Button>

            {/* TX Info */}
            <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                <Typography variant="caption" color="text.secondary">
                    {pttActive ? 'TRANSMITTING' : 'Standby'}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                    {txGain} dB
                </Typography>
            </Box>
        </Paper>
    );
}
