import React, { useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
    Box, Typography, Paper, Button, Slider, ToggleButtonGroup, ToggleButton,
    TextField, InputAdornment
} from '@mui/material';
import { useSocket } from '../common/socket.jsx';
import { setPttActive, setTxGain } from '../bitlink21/bitlink21-slice.jsx';

export default function TXPanel() {
    const dispatch = useDispatch();
    const {socket} = useSocket();
    const { pttActive, txGain } = useSelector(state => state.bitlink21);
    const [txPower, setTxPower] = useState(-10);
    const [toneActive, setToneActive] = useState(false);

    const handlePtt = () => {
        const newState = !pttActive;
        dispatch(setPttActive(newState));
        if (socket) {
            socket.emit('data_submission', newState ? 'bitlink21:ptt_on' : 'bitlink21:ptt_off', {});
        }
    };

    const handleTestTone = () => {
        if (!socket) return;
        if (toneActive) {
            socket.emit('data_submission', 'bitlink21:test_tone_stop', {});
            setToneActive(false);
        } else {
            socket.emit('data_submission', 'bitlink21:test_tone_start', {
                tone_freq_hz: 1000, tx_gain_db: txPower,
            });
            setToneActive(true);
        }
    };

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
                TX Power: {txPower} dB
            </Typography>
            <Slider
                value={txPower}
                onChange={(_, v) => setTxPower(v)}
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
                    {txPower} dB
                </Typography>
            </Box>
        </Paper>
    );
}
