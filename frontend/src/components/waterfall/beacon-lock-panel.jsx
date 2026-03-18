import React, { useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
    Accordion, AccordionSummary, AccordionDetails,
    Box, Typography, TextField, Button, Chip, Divider, InputAdornment, Slider
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import LockIcon from '@mui/icons-material/Lock';
import LockOpenIcon from '@mui/icons-material/LockOpen';
import TrackChangesIcon from '@mui/icons-material/TrackChanges';
import { useSocket } from '../common/socket.jsx';

const lockStateColors = {
    UNLOCKED: 'error',
    TRACKING: 'warning',
    LOCKED: 'success',
};

const lockStateIcons = {
    UNLOCKED: <LockOpenIcon fontSize="small" />,
    TRACKING: <TrackChangesIcon fontSize="small" />,
    LOCKED: <LockIcon fontSize="small" />,
};

const BeaconLockAccordion = ({ expanded, onAccordionChange }) => {
    const {socket} = useSocket();
    const { beaconLockState, beaconOffset, beaconPhaseError } = useSelector(state => state.bitlink21);

    const [beaconFreq, setBeaconFreq] = useState('10489500000');
    const [xoCorrection, setXoCorrection] = useState(0);
    const isRunning = beaconLockState !== 'UNLOCKED';

    const handleStartLock = () => {
        if (!socket) return;
        socket.emit('data_submission', 'bitlink21:beacon_start', {
            beacon_freq_hz: parseFloat(beaconFreq),
        });
    };

    const handleStopLock = () => {
        if (!socket) return;
        socket.emit('data_submission', 'bitlink21:beacon_stop', {});
    };

    const handleManualXO = () => {
        if (!socket) return;
        socket.emit('data_submission', 'bitlink21:set_config', {
            key: 'xo_correction', value: String(xoCorrection),
        });
    };

    return (
        <Accordion expanded={expanded} onChange={onAccordionChange}>
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
                    <TrackChangesIcon fontSize="small" />
                    <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                        Beacon Lock
                    </Typography>
                    <Chip
                        icon={lockStateIcons[beaconLockState] || lockStateIcons.UNLOCKED}
                        label={beaconLockState || 'UNLOCKED'}
                        color={lockStateColors[beaconLockState] || 'default'}
                        size="small"
                        sx={{ ml: 'auto', mr: 1 }}
                    />
                </Box>
            </AccordionSummary>
            <AccordionDetails>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {/* Beacon Frequency */}
                    <TextField
                        size="small"
                        label="Beacon Frequency"
                        value={beaconFreq}
                        onChange={e => setBeaconFreq(e.target.value)}
                        InputProps={{
                            endAdornment: <InputAdornment position="end">Hz</InputAdornment>,
                            sx: { fontFamily: 'monospace', fontSize: '0.85rem' },
                        }}
                        helperText="QO-100 CW beacon: 10489500000 Hz"
                    />

                    {/* Lock/Unlock Button */}
                    <Button
                        variant="contained"
                        fullWidth
                        onClick={isRunning ? handleStopLock : handleStartLock}
                        color={isRunning ? 'error' : 'primary'}
                    >
                        {isRunning ? 'Stop Beacon Lock' : 'Start Beacon Lock'}
                    </Button>

                    {/* Status */}
                    {isRunning && (
                        <>
                            <Divider />
                            <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                                <Typography variant="caption" color="text.secondary">Offset</Typography>
                                <Typography variant="body2" sx={{ fontFamily: 'monospace', fontWeight: 600 }}>
                                    {beaconOffset > 0 ? '+' : ''}{beaconOffset.toFixed(1)} Hz
                                </Typography>
                            </Box>
                            <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                                <Typography variant="caption" color="text.secondary">Phase Error</Typography>
                                <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                                    {beaconPhaseError.toFixed(2)}°
                                </Typography>
                            </Box>
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

export default BeaconLockAccordion;
