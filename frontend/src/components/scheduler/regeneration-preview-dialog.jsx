/**
 * @license
 * Copyright (c) 2025 Efstratios Goudelis
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 *
 */

import React, { useState } from 'react';
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    Alert,
    AlertTitle,
    Box,
    Typography,
    Radio,
    RadioGroup,
    FormControlLabel,
    Divider,
    Chip,
    Stack,
} from '@mui/material';
import { Warning as WarningIcon, CheckCircle as CheckCircleIcon } from '@mui/icons-material';
import { useUserTimeSettings } from '../../hooks/useUserTimeSettings.jsx';
import { formatTime } from '../../utils/date-time.js';

const RegenerationPreviewDialog = ({ open, onClose, previewData, onConfirm }) => {
    const [conflictChoices, setConflictChoices] = useState({});
    const { timezone, locale } = useUserTimeSettings();

    if (!previewData) return null;

    const { conflicts = [], no_conflicts = [], current_strategy = 'priority' } = previewData;

    const handleConflictChoice = (conflictId, action) => {
        setConflictChoices(prev => ({
            ...prev,
            [conflictId]: action
        }));
    };

    const handleApplyStrategy = () => {
        // Reset to strategy defaults
        setConflictChoices({});
    };

    const handleConfirm = () => {
        onConfirm(conflictChoices);
    };

    const getStrategyDescription = () => {
        switch (current_strategy) {
            case 'priority':
                return 'Highest elevation passes are kept';
            case 'skip':
                return 'All conflicting passes are skipped';
            case 'force':
                return 'All passes are scheduled (allows overlaps)';
            default:
                return 'Unknown strategy';
        }
    };

    const hasConflicts = conflicts.length > 0;
    const totalPasses = conflicts.length + no_conflicts.length;

    return (
        <Dialog
            open={open}
            onClose={onClose}
            maxWidth="md"
            fullWidth
        >
            <DialogTitle sx={!hasConflicts ? {
                bgcolor: (theme) => theme.palette.mode === 'dark'
                    ? 'rgba(46, 125, 50, 0.08)'
                    : 'rgba(46, 125, 50, 0.04)',
            } : {}}>
                Regeneration Preview
            </DialogTitle>

            <DialogContent>
                <Alert severity={!hasConflicts ? "success" : "info"} sx={{ mb: 2 }}>
                    <AlertTitle>
                        {!hasConflicts ? "No Conflicts - Ready to Generate" : `Auto-generation Strategy: ${current_strategy.toUpperCase()}`}
                    </AlertTitle>
                    {!hasConflicts ? (
                        <>All passes can be scheduled without conflicts. Click "Confirm & Generate" to proceed.</>
                    ) : (
                        <>
                            {getStrategyDescription()}
                            <br />
                            <strong>Changes here apply ONLY to this regeneration.</strong>
                        </>
                    )}
                </Alert>

                {/* Summary */}
                <Box sx={{ mb: 3 }}>
                    <Typography variant="h6" gutterBottom>
                        Summary
                    </Typography>
                    <Stack direction="row" spacing={2}>
                        <Chip
                            label={`${totalPasses} Total Passes`}
                            color="primary"
                            variant="outlined"
                        />
                        {hasConflicts && (
                            <Chip
                                label={`${conflicts.length} Conflicts`}
                                color="warning"
                                icon={<WarningIcon />}
                            />
                        )}
                        {no_conflicts.length > 0 && (
                            <Chip
                                label={`${no_conflicts.length} No Conflicts`}
                                color="success"
                                icon={<CheckCircleIcon />}
                            />
                        )}
                    </Stack>
                </Box>

                {/* No Conflicts Section */}
                {no_conflicts.length > 0 && (
                    <Box sx={{ mb: 3 }}>
                        <Typography variant="h6" gutterBottom>
                            Passes Without Conflicts ({no_conflicts.length})
                        </Typography>
                        <Box sx={{
                            maxHeight: 150,
                            overflowY: 'auto',
                            border: '1px solid',
                            borderColor: 'success.main',
                            borderRadius: 1,
                            bgcolor: (theme) => theme.palette.mode === 'dark'
                                ? 'rgba(46, 125, 50, 0.08)'
                                : 'rgba(46, 125, 50, 0.04)',
                        }}>
                            <Box sx={{
                                display: 'grid',
                                gridTemplateColumns: '2fr 1fr 2fr',
                                gap: 1,
                                p: 1,
                                borderBottom: '1px solid',
                                borderColor: 'divider',
                                bgcolor: (theme) => theme.palette.mode === 'dark'
                                    ? 'rgba(0, 0, 0, 0.2)'
                                    : 'rgba(0, 0, 0, 0.05)',
                            }}>
                                <Typography variant="caption" fontWeight="bold">Satellite</Typography>
                                <Typography variant="caption" fontWeight="bold">Elevation</Typography>
                                <Typography variant="caption" fontWeight="bold">Time</Typography>
                            </Box>
                            {no_conflicts.map((pass, idx) => (
                                <Box
                                    key={idx}
                                    sx={{
                                        display: 'grid',
                                        gridTemplateColumns: '2fr 1fr 2fr',
                                        gap: 1,
                                        p: 1,
                                        borderBottom: idx < no_conflicts.length - 1 ? '1px solid' : 'none',
                                        borderColor: 'divider',
                                        '&:hover': {
                                            bgcolor: (theme) => theme.palette.mode === 'dark'
                                                ? 'rgba(255, 255, 255, 0.05)'
                                                : 'rgba(0, 0, 0, 0.02)',
                                        }
                                    }}
                                >
                                    <Typography variant="body2" color="text.secondary">
                                        {pass.satellite}
                                    </Typography>
                                    <Typography variant="body2" color="text.secondary">
                                        {pass.elevation.toFixed(1)}°
                                    </Typography>
                                    <Typography variant="body2" color="text.secondary">
                                        {pass.time_window}
                                    </Typography>
                                </Box>
                            ))}
                        </Box>
                    </Box>
                )}

                {/* Conflicts Section */}
                {hasConflicts && (
                    <Box>
                        <Typography variant="h6" gutterBottom>
                            Conflicts Detected ({conflicts.length})
                        </Typography>

                        {conflicts.map((conflict, idx) => {
                            const conflictId = conflict.conflict_id;
                            const userChoice = conflictChoices[conflictId];
                            const effectiveAction = userChoice || conflict.strategy_action;

                            return (
                                <Box
                                    key={idx}
                                    sx={{
                                        mb: 2,
                                        p: 2,
                                        border: '1px solid',
                                        borderColor: 'divider',
                                        borderRadius: 1,
                                        bgcolor: 'background.paper',
                                    }}
                                >
                                    <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                                        Time: {conflict.time_window}
                                    </Typography>

                                    <RadioGroup
                                        value={effectiveAction}
                                        onChange={(e) => handleConflictChoice(conflictId, e.target.value)}
                                    >
                                        <FormControlLabel
                                            value="keep"
                                            control={<Radio size="small" />}
                                            label={
                                                <Typography variant="body2" component="span">
                                                    <strong>Keep Existing:</strong> {conflict.existing_obs.satellite}
                                                    <Chip
                                                        label={`${conflict.existing_obs.elevation.toFixed(1)}°`}
                                                        size="small"
                                                        sx={{ ml: 1 }}
                                                    />
                                                    <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                                                        ({formatTime(conflict.existing_obs.start, { timezone, locale, options: { hour: '2-digit', minute: '2-digit', hour12: false } })} - {formatTime(conflict.existing_obs.end, { timezone, locale, options: { hour: '2-digit', minute: '2-digit', hour12: false } })})
                                                    </Typography>
                                                    {effectiveAction === 'keep' && conflict.strategy_action === 'keep' && (
                                                        <Chip
                                                            label="Strategy Default"
                                                            size="small"
                                                            color="info"
                                                            sx={{ ml: 1 }}
                                                        />
                                                    )}
                                                </Typography>
                                            }
                                        />
                                        <FormControlLabel
                                            value="replace"
                                            control={<Radio size="small" />}
                                            label={
                                                <Typography variant="body2" component="span">
                                                    <strong>Replace with New:</strong> {conflict.new_pass.satellite}
                                                    <Chip
                                                        label={`${conflict.new_pass.elevation.toFixed(1)}°`}
                                                        size="small"
                                                        sx={{ ml: 1 }}
                                                    />
                                                    <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                                                        ({formatTime(conflict.new_pass.start, { timezone, locale, options: { hour: '2-digit', minute: '2-digit', hour12: false } })} - {formatTime(conflict.new_pass.end, { timezone, locale, options: { hour: '2-digit', minute: '2-digit', hour12: false } })})
                                                    </Typography>
                                                    {effectiveAction === 'replace' && conflict.strategy_action === 'replace' && (
                                                        <Chip
                                                            label="Strategy Default"
                                                            size="small"
                                                            color="info"
                                                            sx={{ ml: 1 }}
                                                        />
                                                    )}
                                                </Typography>
                                            }
                                        />
                                    </RadioGroup>

                                    {idx < conflicts.length - 1 && <Divider sx={{ mt: 2 }} />}
                                </Box>
                            );
                        })}
                    </Box>
                )}
            </DialogContent>

            <DialogActions>
                <Button onClick={onClose} variant="outlined">
                    Cancel
                </Button>
                {hasConflicts && (
                    <Button onClick={handleApplyStrategy} variant="outlined" color="info">
                        Reset to Strategy Defaults
                    </Button>
                )}
                <Button onClick={handleConfirm} variant="contained" color="primary">
                    Confirm & Generate
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default RegenerationPreviewDialog;
