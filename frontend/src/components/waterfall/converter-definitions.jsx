import React, { useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
    Dialog, DialogTitle, DialogContent, DialogActions,
    Box, Typography, Button, TextField, Select, MenuItem, FormControl, InputLabel,
    Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
    IconButton, Paper, InputAdornment, Chip
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import {
    setActiveConverterId, addConverterDefinition, removeConverterDefinition
} from './waterfall-slice.jsx';

const formatFreqMHz = (hz) => {
    if (!hz) return '0';
    return `${(hz / 1e6).toFixed(3)} MHz`;
};

const ConverterDefinitionsDialog = ({ open, onClose }) => {
    const dispatch = useDispatch();
    const { converterDefinitions, activeConverterId } = useSelector(state => state.waterfall);

    const [editing, setEditing] = useState(false);
    const [editForm, setEditForm] = useState({ id: '', name: '', type: 'down', rxOffset: '', txOffset: '' });

    const handleAdd = () => {
        setEditing(true);
        setEditForm({
            id: `conv_${Date.now()}`,
            name: '',
            type: 'down',
            rxOffset: '',
            txOffset: '',
        });
    };

    const handleSave = () => {
        if (!editForm.name) return;
        dispatch(addConverterDefinition({
            id: editForm.id,
            name: editForm.name,
            type: editForm.type,
            rxOffset: parseFloat(editForm.rxOffset) || 0,
            txOffset: parseFloat(editForm.txOffset) || 0,
        }));
        setEditing(false);
    };

    const handleDelete = (id) => {
        if (id === 'none') return; // Can't delete "None"
        dispatch(removeConverterDefinition(id));
    };

    const handleSelect = (id) => {
        dispatch(setActiveConverterId(id));
    };

    return (
        <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
            <DialogTitle>Converter Definitions</DialogTitle>
            <DialogContent>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    Define frequency converters (LNBs, upconverters) for satellite operation.
                    RX offset is subtracted from the tuned frequency for downconverters.
                    TX offset defines the uplink frequency shift.
                </Typography>

                <TableContainer component={Paper} variant="outlined">
                    <Table size="small">
                        <TableHead>
                            <TableRow>
                                <TableCell>Active</TableCell>
                                <TableCell>Name</TableCell>
                                <TableCell>Type</TableCell>
                                <TableCell>RX Offset</TableCell>
                                <TableCell>TX Offset</TableCell>
                                <TableCell width={80}>Actions</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {converterDefinitions.map(conv => (
                                <TableRow
                                    key={conv.id}
                                    selected={conv.id === activeConverterId}
                                    hover
                                    onClick={() => handleSelect(conv.id)}
                                    sx={{ cursor: 'pointer' }}
                                >
                                    <TableCell>
                                        {conv.id === activeConverterId
                                            ? <Chip label="Active" color="success" size="small" />
                                            : <Chip label="Select" variant="outlined" size="small" />
                                        }
                                    </TableCell>
                                    <TableCell sx={{ fontWeight: conv.id === activeConverterId ? 700 : 400 }}>
                                        {conv.name}
                                    </TableCell>
                                    <TableCell>
                                        <Chip
                                            label={conv.type === 'down' ? 'Down ▼' : conv.type === 'up' ? 'Up ▲' : 'None'}
                                            size="small"
                                            color={conv.type === 'down' ? 'info' : conv.type === 'up' ? 'warning' : 'default'}
                                            variant="outlined"
                                        />
                                    </TableCell>
                                    <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>
                                        {conv.rxOffset ? formatFreqMHz(conv.rxOffset) : '—'}
                                    </TableCell>
                                    <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>
                                        {conv.txOffset ? formatFreqMHz(conv.txOffset) : '—'}
                                    </TableCell>
                                    <TableCell>
                                        {conv.id !== 'none' && (
                                            <IconButton size="small" color="error" onClick={(e) => { e.stopPropagation(); handleDelete(conv.id); }}>
                                                <DeleteIcon fontSize="small" />
                                            </IconButton>
                                        )}
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </TableContainer>

                {editing && (
                    <Paper variant="outlined" sx={{ p: 2, mt: 2 }}>
                        <Typography variant="subtitle2" sx={{ mb: 1.5, fontWeight: 600 }}>New Converter</Typography>
                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                            <Box sx={{ display: 'flex', gap: 2 }}>
                                <TextField
                                    label="Name"
                                    value={editForm.name}
                                    onChange={e => setEditForm({ ...editForm, name: e.target.value })}
                                    size="small"
                                    sx={{ flex: 1 }}
                                    placeholder="e.g. QO-100"
                                />
                                <FormControl size="small" sx={{ minWidth: 150 }}>
                                    <InputLabel>Type</InputLabel>
                                    <Select
                                        value={editForm.type}
                                        label="Type"
                                        onChange={e => setEditForm({ ...editForm, type: e.target.value })}
                                    >
                                        <MenuItem value="down">Down-converter ▼</MenuItem>
                                        <MenuItem value="up">Up-converter ▲</MenuItem>
                                    </Select>
                                </FormControl>
                            </Box>
                            <Box sx={{ display: 'flex', gap: 2 }}>
                                <TextField
                                    label="RX Offset"
                                    value={editForm.rxOffset}
                                    onChange={e => setEditForm({ ...editForm, rxOffset: e.target.value })}
                                    size="small"
                                    type="number"
                                    sx={{ flex: 1 }}
                                    placeholder="9750000000"
                                    InputProps={{
                                        endAdornment: <InputAdornment position="end">Hz</InputAdornment>,
                                        sx: { fontFamily: 'monospace' },
                                    }}
                                    helperText="QO-100 RX: 9750000000 (9.75 GHz)"
                                />
                                <TextField
                                    label="TX Offset"
                                    value={editForm.txOffset}
                                    onChange={e => setEditForm({ ...editForm, txOffset: e.target.value })}
                                    size="small"
                                    type="number"
                                    sx={{ flex: 1 }}
                                    placeholder="8089500000"
                                    InputProps={{
                                        endAdornment: <InputAdornment position="end">Hz</InputAdornment>,
                                        sx: { fontFamily: 'monospace' },
                                    }}
                                    helperText="QO-100 TX: 8089500000 (8.0895 GHz)"
                                />
                            </Box>
                            <Box sx={{ display: 'flex', gap: 1 }}>
                                <Button variant="contained" size="small" onClick={handleSave} disabled={!editForm.name}>
                                    Save
                                </Button>
                                <Button variant="outlined" size="small" onClick={() => setEditing(false)}>
                                    Cancel
                                </Button>
                            </Box>
                        </Box>
                    </Paper>
                )}
            </DialogContent>
            <DialogActions>
                {!editing && (
                    <Button startIcon={<AddIcon />} onClick={handleAdd}>
                        Add Converter
                    </Button>
                )}
                <Box sx={{ flex: 1 }} />
                <Button onClick={onClose}>Close</Button>
            </DialogActions>
        </Dialog>
    );
};

export default ConverterDefinitionsDialog;
