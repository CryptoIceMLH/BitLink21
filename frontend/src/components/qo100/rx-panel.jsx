import React, { useState } from 'react';
import { useSelector } from 'react-redux';
import {
    Box, Typography, Paper, ToggleButtonGroup, ToggleButton,
    Select, MenuItem, FormControl, InputLabel, TextField, InputAdornment
} from '@mui/material';

const FILTER_PRESETS = [
    { value: 2000, label: '2.0k' },
    { value: 2700, label: '2.7k' },
    { value: 3600, label: '3.6k' },
    { value: 4400, label: '4.4k' },
    { value: 5000, label: '5.0k' },
];

export default function RXPanel() {
    const [filterBw, setFilterBw] = useState(3600);
    const [modulation, setModulation] = useState('qpsk');
    const [baudrate, setBaudrate] = useState(4800);

    return (
        <Paper sx={{ p: 1.5, flex: 1, overflow: 'auto' }}>
            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700, mb: 1, display: 'block' }}>
                RX CONTROLS
            </Typography>

            {/* Filter Width */}
            <Typography variant="caption" color="text.secondary">Filter</Typography>
            <ToggleButtonGroup
                value={filterBw}
                exclusive
                onChange={(_, v) => v && setFilterBw(v)}
                size="small"
                fullWidth
                sx={{ mb: 1, '& .MuiToggleButton-root': { fontSize: '0.7rem', py: 0.3 } }}
            >
                {FILTER_PRESETS.map(f => (
                    <ToggleButton key={f.value} value={f.value}>{f.label}</ToggleButton>
                ))}
            </ToggleButtonGroup>

            {/* Modulation */}
            <FormControl size="small" fullWidth sx={{ mb: 1 }}>
                <InputLabel sx={{ fontSize: '0.75rem' }}>Modulation</InputLabel>
                <Select
                    value={modulation}
                    label="Modulation"
                    onChange={e => setModulation(e.target.value)}
                    sx={{ fontSize: '0.8rem' }}
                >
                    <MenuItem value="bpsk">BPSK</MenuItem>
                    <MenuItem value="qpsk">QPSK</MenuItem>
                    <MenuItem value="8psk">8PSK</MenuItem>
                    <MenuItem value="8apsk">8APSK</MenuItem>
                    <MenuItem value="16qam">16QAM</MenuItem>
                    <MenuItem value="dqpsk">DQPSK</MenuItem>
                </Select>
            </FormControl>

            {/* Baudrate */}
            <TextField
                size="small"
                fullWidth
                label="Baudrate"
                value={baudrate}
                onChange={e => setBaudrate(parseInt(e.target.value) || 0)}
                type="number"
                InputProps={{
                    endAdornment: <InputAdornment position="end">Bd</InputAdornment>,
                    sx: { fontSize: '0.8rem', fontFamily: 'monospace' },
                }}
                sx={{ mb: 1 }}
            />

            {/* Info */}
            <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                <Typography variant="caption" color="text.secondary">BW: {filterBw} Hz</Typography>
                <Typography variant="caption" color="text.secondary">{modulation.toUpperCase()} @ {baudrate}</Typography>
            </Box>
        </Paper>
    );
}
