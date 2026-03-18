import React, { useState } from 'react';
import {
    Box, Typography, TextField, Switch, FormControlLabel, InputAdornment, Button
} from '@mui/material';

const RitXitControls = ({ onRitChange, onXitChange }) => {
    const [ritEnabled, setRitEnabled] = useState(false);
    const [xitEnabled, setXitEnabled] = useState(false);
    const [ritOffset, setRitOffset] = useState(0);
    const [xitOffset, setXitOffset] = useState(0);

    const handleRitToggle = (enabled) => {
        setRitEnabled(enabled);
        onRitChange?.(enabled ? ritOffset : 0);
    };

    const handleXitToggle = (enabled) => {
        setXitEnabled(enabled);
        onXitChange?.(enabled ? xitOffset : 0);
    };

    const handleRitOffsetChange = (value) => {
        const v = parseInt(value) || 0;
        setRitOffset(v);
        if (ritEnabled) onRitChange?.(v);
    };

    const handleXitOffsetChange = (value) => {
        const v = parseInt(value) || 0;
        setXitOffset(v);
        if (xitEnabled) onXitChange?.(v);
    };

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
                RIT / XIT Fine Tuning
            </Typography>

            {/* RIT */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <FormControlLabel
                    control={
                        <Switch
                            checked={ritEnabled}
                            onChange={e => handleRitToggle(e.target.checked)}
                            size="small"
                        />
                    }
                    label={<Typography variant="caption">RIT</Typography>}
                    sx={{ mr: 0, minWidth: 60 }}
                />
                <TextField
                    size="small"
                    value={ritOffset}
                    onChange={e => handleRitOffsetChange(e.target.value)}
                    disabled={!ritEnabled}
                    type="number"
                    InputProps={{
                        endAdornment: <InputAdornment position="end">Hz</InputAdornment>,
                        sx: { fontFamily: 'monospace', fontSize: '0.8rem' },
                        inputProps: { step: 10 },
                    }}
                    sx={{ flex: 1 }}
                />
                <Button
                    size="small"
                    variant="text"
                    onClick={() => handleRitOffsetChange(0)}
                    disabled={!ritEnabled}
                    sx={{ minWidth: 'auto', fontSize: '0.7rem' }}
                >
                    CLR
                </Button>
            </Box>

            {/* XIT */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <FormControlLabel
                    control={
                        <Switch
                            checked={xitEnabled}
                            onChange={e => handleXitToggle(e.target.checked)}
                            size="small"
                        />
                    }
                    label={<Typography variant="caption">XIT</Typography>}
                    sx={{ mr: 0, minWidth: 60 }}
                />
                <TextField
                    size="small"
                    value={xitOffset}
                    onChange={e => handleXitOffsetChange(e.target.value)}
                    disabled={!xitEnabled}
                    type="number"
                    InputProps={{
                        endAdornment: <InputAdornment position="end">Hz</InputAdornment>,
                        sx: { fontFamily: 'monospace', fontSize: '0.8rem' },
                        inputProps: { step: 10 },
                    }}
                    sx={{ flex: 1 }}
                />
                <Button
                    size="small"
                    variant="text"
                    onClick={() => handleXitOffsetChange(0)}
                    disabled={!xitEnabled}
                    sx={{ minWidth: 'auto', fontSize: '0.7rem' }}
                >
                    CLR
                </Button>
            </Box>
        </Box>
    );
};

export default RitXitControls;
