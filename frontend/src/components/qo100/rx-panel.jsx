import React, { useState, useEffect } from 'react';
import { useSelector } from 'react-redux';
import { useSocket } from '../common/socket.jsx';
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
    const {socket} = useSocket();
    const [filterBw, setFilterBw] = useState(3600);
    const [modulation, setModulation] = useState('qpsk');
    const [baudrate, setBaudrate] = useState(4800);

    // Send filter change to backend
    useEffect(() => {
        if (socket) {
            socket.emit('data_submission', 'bitlink21:qo100_set_filter', { bandwidth: filterBw });
        }
    }, [filterBw, socket]);

    // Send modulation change to backend
    useEffect(() => {
        if (socket) {
            socket.emit('data_submission', 'bitlink21:qo100_set_modulation', {
                modulation, baudrate
            });
        }
    }, [modulation, baudrate, socket]);

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
                    <MenuItem value="psk16">16PSK</MenuItem>
                    <MenuItem value="psk32">32PSK</MenuItem>
                    <MenuItem value="psk64">64PSK</MenuItem>
                    <MenuItem value="psk128">128PSK</MenuItem>
                    <MenuItem value="psk256">256PSK</MenuItem>
                    <MenuItem disabled><em>— Differential —</em></MenuItem>
                    <MenuItem value="dbpsk">DBPSK</MenuItem>
                    <MenuItem value="dqpsk">DQPSK</MenuItem>
                    <MenuItem value="d8psk">D8PSK</MenuItem>
                    <MenuItem value="d16psk">D16PSK</MenuItem>
                    <MenuItem disabled><em>— APSK —</em></MenuItem>
                    <MenuItem value="8apsk">8APSK</MenuItem>
                    <MenuItem value="16apsk">16APSK</MenuItem>
                    <MenuItem value="32apsk">32APSK</MenuItem>
                    <MenuItem value="64apsk">64APSK</MenuItem>
                    <MenuItem value="128apsk">128APSK</MenuItem>
                    <MenuItem value="256apsk">256APSK</MenuItem>
                    <MenuItem disabled><em>— QAM —</em></MenuItem>
                    <MenuItem value="16qam">16QAM</MenuItem>
                    <MenuItem value="qam32">32QAM</MenuItem>
                    <MenuItem value="qam64">64QAM</MenuItem>
                    <MenuItem value="qam128">128QAM</MenuItem>
                    <MenuItem value="qam256">256QAM</MenuItem>
                    <MenuItem disabled><em>— ASK —</em></MenuItem>
                    <MenuItem value="ask2">OOK/ASK2</MenuItem>
                    <MenuItem value="ask4">4ASK</MenuItem>
                    <MenuItem value="ask8">8ASK</MenuItem>
                    <MenuItem value="ask16">16ASK</MenuItem>
                    <MenuItem disabled><em>— FSK —</em></MenuItem>
                    <MenuItem value="gmsk">GMSK</MenuItem>
                    <MenuItem value="2fsk">2FSK</MenuItem>
                    <MenuItem value="4fsk">4FSK</MenuItem>
                    <MenuItem value="8fsk">8FSK</MenuItem>
                    <MenuItem disabled><em>— Special —</em></MenuItem>
                    <MenuItem value="v29">V.29</MenuItem>
                    <MenuItem value="pi4dqpsk">π/4-DQPSK</MenuItem>
                    <MenuItem value="sqam32">32SQAM</MenuItem>
                    <MenuItem value="sqam128">128SQAM</MenuItem>
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
