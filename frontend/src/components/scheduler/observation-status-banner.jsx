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

import React, { useMemo, useState, useEffect } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { Box, Paper, Typography, Chip, Stack, Button, Tooltip, Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions } from '@mui/material';
import { AccessTime, RadioButtonChecked, Satellite, Router, Visibility, Cancel, Stop } from '@mui/icons-material';
import { useSocket } from '../common/socket.jsx';
import { cancelRunningObservation } from './scheduler-slice.jsx';
import { getFlattenedTasks, getSessionSdrs } from './session-utils.js';
import { useUserTimeSettings } from '../../hooks/useUserTimeSettings.jsx';
import { formatTime as formatTimeHelper } from '../../utils/date-time.js';

/**
 * Compact banner showing either:
 * - Currently running observation with details
 * - Next upcoming observation with countdown
 */
export default function ObservationStatusBanner() {
    const dispatch = useDispatch();
    const { socket } = useSocket();
    const observations = useSelector((state) => state.scheduler.observations);
    const [countdown, setCountdown] = useState('');
    const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
    const [isSatelliteVisible, setIsSatelliteVisible] = useState(false);
    const { timezone, locale } = useUserTimeSettings();

    const { runningObservation, nextObservation } = useMemo(() => {
        const now = new Date();
        const running = observations.find((obs) => obs.status === 'running' && obs.enabled);

        // Find next enabled scheduled observation
        const upcoming = observations
            .filter((obs) => {
                if (!obs.enabled || obs.status !== 'scheduled' || !obs.pass) return false;
                // Use task_start (root level) if available, fallback to event_start (in pass)
                return obs.task_start || obs.pass.event_start;
            })
            .map((obs) => ({
                ...obs,
                // Use task_start (root level) if available, fallback to event_start (in pass)
                startTime: new Date(obs.task_start || obs.pass.event_start),
            }))
            .filter((obs) => obs.startTime > now)
            .sort((a, b) => a.startTime - b.startTime)[0];

        return { runningObservation: running, nextObservation: upcoming };
    }, [observations]);

    const observation = runningObservation || nextObservation;
    const isRunning = !!runningObservation;

    // Handler to open confirmation dialog
    const handleCancelClick = () => {
        setConfirmDialogOpen(true);
    };

    // Handler for confirming cancellation
    const handleConfirmCancel = () => {
        if (observation?.id && socket) {
            dispatch(cancelRunningObservation({ socket, id: observation.id }));
        }
        setConfirmDialogOpen(false);
    };

    // Handler for closing dialog
    const handleCloseDialog = () => {
        setConfirmDialogOpen(false);
    };


    // Live countdown and satellite visibility check for scheduled observations
    useEffect(() => {
        if (!observation?.pass) return;

        const updateCountdown = () => {
            const now = new Date();

            // Check if satellite is visible (for upcoming observations)
            if (!isRunning) {
                const eventStart = new Date(observation.pass.event_start); // AOS time
                const taskStart = new Date(observation.task_start || observation.pass.event_start); // Task start time
                // Satellite is visible if AOS has passed but task hasn't started yet
                setIsSatelliteVisible(now >= eventStart && now < taskStart);
            } else {
                setIsSatelliteVisible(false);
            }

            if (isRunning) {
                // Use task_end (root level) if available, fallback to event_end (in pass)
                const endTime = new Date(observation.task_end || observation.pass.event_end);
                const remainingMs = endTime - now;

                if (remainingMs <= 0) {
                    setCountdown('Ending soon');
                } else {
                    const hours = Math.floor(remainingMs / 3600000);
                    const minutes = Math.floor((remainingMs % 3600000) / 60000);
                    const seconds = Math.floor((remainingMs % 60000) / 1000);

                    if (hours > 0) {
                        setCountdown(`${hours}h ${minutes}m ${seconds}s remaining`);
                    } else if (minutes > 0) {
                        setCountdown(`${minutes}m ${seconds}s remaining`);
                    } else {
                        setCountdown(`${seconds}s remaining`);
                    }
                }
            } else {
                // Use task_start (root level) if available, fallback to event_start (in pass)
                const startTime = new Date(observation.task_start || observation.pass.event_start);
                const untilMs = startTime - now;
                const hours = Math.floor(untilMs / 3600000);
                const minutes = Math.floor((untilMs % 3600000) / 60000);
                const seconds = Math.floor((untilMs % 60000) / 1000);

                if (hours > 24) {
                    const days = Math.floor(hours / 24);
                    setCountdown(`in ${days}d ${hours % 24}h`);
                } else if (hours > 0) {
                    setCountdown(`in ${hours}h ${minutes}m`);
                } else {
                    setCountdown(`in ${minutes}m ${seconds}s`);
                }
            }
        };

        // Update immediately
        updateCountdown();

        // Update every second
        const interval = setInterval(updateCountdown, 1000);

        return () => clearInterval(interval);
    }, [observation, isRunning]);

    // Show banner even if nothing to display
    if (!runningObservation && !nextObservation) {
        return (
            <Paper
                elevation={2}
                sx={{
                    p: 2,
                    background: 'linear-gradient(135deg, rgba(158, 158, 158, 0.15) 0%, rgba(158, 158, 158, 0.10) 100%)',
                    borderLeft: '4px solid #9e9e9e',
                }}
            >
                <Stack direction="row" alignItems="center" spacing={2}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Satellite sx={{ color: 'text.secondary', fontSize: 20 }} />
                        <Typography variant="body2" fontWeight={600} color="text.secondary">
                            NO SCHEDULED OBSERVATIONS
                        </Typography>
                    </Box>
                    <Typography variant="body2" color="text.secondary">
                        No active or upcoming observations scheduled
                    </Typography>
                </Stack>
            </Paper>
        );
    }

    // Format start/end times
    const formatTime = (isoString) => {
        if (!isoString) return '';
        return formatTimeHelper(isoString, {
            timezone,
            locale,
            options: { hour: '2-digit', minute: '2-digit' },
        });
    };

    // Use task_start/task_end (root level) if available, fallback to event_start/event_end (in pass)
    const startTime = formatTime(observation.task_start || observation.pass?.event_start);
    const endTime = formatTime(observation.task_end || observation.pass?.event_end);

    // Get task count
    const tasks = getFlattenedTasks(observation);
    const sdrs = getSessionSdrs(observation);
    const taskCount = tasks.length;
    const decoderTasks = tasks.filter((t) => t.type === 'decoder').length;
    const recordingTasks = tasks.filter((t) => t.type === 'iq_recording' || t.type === 'audio_recording').length;
    const transcriptionTasks = tasks.filter((t) => t.type === 'transcription').length;

    return (
        <Paper
            elevation={2}
            sx={{
                p: 2,
                background: isRunning
                    ? 'linear-gradient(135deg, rgba(76, 175, 80, 0.25) 0%, rgba(76, 175, 80, 0.15) 100%)'
                    : 'linear-gradient(135deg, rgba(33, 150, 243, 0.25) 0%, rgba(33, 150, 243, 0.15) 100%)',
                borderLeft: isRunning ? '4px solid #4caf50' : '4px solid #2196f3',
            }}
        >
            <Stack direction="row" alignItems="center" spacing={2} flexWrap="wrap" sx={{ position: 'relative', pr: 10 }}>
                {/* Status indicator */}
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    {isRunning ? (
                        <RadioButtonChecked sx={{ color: '#4caf50', fontSize: 20 }} />
                    ) : (
                        <AccessTime sx={{ color: '#2196f3', fontSize: 20 }} />
                    )}
                    <Typography variant="body2" fontWeight={600} color="text.secondary">
                        {isRunning ? 'NOW OBSERVING' : 'NEXT OBSERVATION'}
                    </Typography>
                </Box>

                {/* Satellite name */}
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Typography variant="body1" fontWeight={600}>
                        {observation.satellite?.name || 'Unknown'}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                        ({observation.satellite?.norad_id || 'N/A'})
                    </Typography>
                </Box>

                {/* Time info */}
                {countdown && (
                    <Chip
                        label={countdown}
                        size="small"
                        sx={{
                            bgcolor: isRunning ? 'rgba(76, 175, 80, 0.2)' : 'rgba(33, 150, 243, 0.2)',
                            fontWeight: 600,
                        }}
                    />
                )}

                {/* Satellite visible indicator (for upcoming observations) */}
                {isSatelliteVisible && (
                    <Chip
                        icon={<Visibility sx={{ fontSize: 16 }} />}
                        label="Satellite visible"
                        size="small"
                        color="success"
                        variant="outlined"
                        sx={{
                            fontWeight: 600,
                            borderWidth: 2,
                        }}
                    />
                )}

                {/* Pass times */}
                {startTime && endTime && (
                    <Typography variant="body2" color="text.secondary">
                        {startTime} - {endTime}
                    </Typography>
                )}

                {/* Peak elevation */}
                {observation.pass?.peak_altitude && (
                    <Chip
                        label={`${observation.pass.peak_altitude.toFixed(0)}° peak`}
                        size="small"
                        variant="outlined"
                    />
                )}

                {/* SDR info */}
                {sdrs.length > 0 && (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <Router sx={{ fontSize: 16, color: 'text.secondary' }} />
                        <Typography variant="body2" color="text.secondary">
                            {sdrs.length === 1 ? sdrs[0]?.name : `${sdrs.length} SDRs`}
                        </Typography>
                    </Box>
                )}

                {/* Task summary */}
                {taskCount > 0 && (
                    <Typography variant="body2" color="text.secondary">
                        {decoderTasks > 0 && `${decoderTasks} decoder${decoderTasks > 1 ? 's' : ''}`}
                        {decoderTasks > 0 && (recordingTasks > 0 || transcriptionTasks > 0) && ', '}
                        {recordingTasks > 0 && `${recordingTasks} recording${recordingTasks > 1 ? 's' : ''}`}
                        {recordingTasks > 0 && transcriptionTasks > 0 && ', '}
                        {transcriptionTasks > 0 && `${transcriptionTasks} transcription${transcriptionTasks > 1 ? 's' : ''}`}
                    </Typography>
                )}

                {/* Observation name (if different from satellite) */}
                {observation.name && observation.name !== observation.satellite?.name && (
                    <Typography variant="body2" color="text.secondary" fontStyle="italic">
                        "{observation.name}"
                    </Typography>
                )}

                {/* Cancel/Stop button - absolutely positioned to always float right */}
                {observation && (
                    <Box sx={{ position: 'absolute', right: 0, top: '50%', transform: 'translateY(-50%)' }}>
                        <Tooltip title={isRunning ? 'Stop observation' : 'Abort scheduled observation'}>
                            <Button
                                variant="outlined"
                                size="small"
                                color="error"
                                startIcon={isRunning ? <Stop /> : <Cancel />}
                                onClick={handleCancelClick}
                            >
                                {isRunning ? 'Stop' : 'Abort'}
                            </Button>
                        </Tooltip>
                    </Box>
                )}
            </Stack>

            {/* Confirmation Dialog */}
            <Dialog open={confirmDialogOpen} onClose={handleCloseDialog}>
                <DialogTitle>
                    {isRunning ? 'Stop Observation' : 'Abort Observation'}
                </DialogTitle>
                <DialogContent>
                    <DialogContentText>
                        {isRunning ? (
                            <>
                                Are you sure you want to stop the observation <strong>{observation?.satellite?.name || 'Unknown'}</strong>?
                                <br />
                                This will immediately stop the observation and remove all scheduled jobs.
                            </>
                        ) : (
                            <>
                                Are you sure you want to abort the observation <strong>{observation?.satellite?.name || 'Unknown'}</strong>?
                                <br />
                                This will cancel the scheduled observation and remove all scheduled jobs.
                            </>
                        )}
                    </DialogContentText>
                </DialogContent>
                <DialogActions>
                    <Button onClick={handleCloseDialog}>
                        Cancel
                    </Button>
                    <Button
                        onClick={handleConfirmCancel}
                        color="error"
                        variant="contained"
                    >
                        {isRunning ? 'Stop' : 'Abort'}
                    </Button>
                </DialogActions>
            </Dialog>
        </Paper>
    );
}
