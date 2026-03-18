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

import React, { useCallback, useState, useEffect, useMemo } from "react";
import { Box, Typography, Chip, Tooltip, Button } from "@mui/material";
import { useDispatch, useSelector } from "react-redux";
import { useSocket } from "../common/socket.jsx";
import { useTranslation } from 'react-i18next';
import SatelliteSearchAutocomplete from "./satellite-search.jsx";
import GroupDropdown from "./group-dropdown.jsx";
import SatelliteList from "./satellite-dropdown.jsx";
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import TrendingDownIcon from '@mui/icons-material/TrendingDown';
import HorizontalRuleIcon from '@mui/icons-material/HorizontalRule';
import GpsFixedIcon from '@mui/icons-material/GpsFixed';
import GpsOffIcon from '@mui/icons-material/GpsOff';
import StopIcon from '@mui/icons-material/Stop';
import {
    setSatelliteId,
    setTrackingStateInBackend,
    setAvailableTransmitters,
} from './target-slice.jsx';

const TargetSatelliteSelectorBar = React.memo(function TargetSatelliteSelectorBar() {
    const { socket } = useSocket();
    const dispatch = useDispatch();
    const { t } = useTranslation('target');

    const {
        trackingState,
        selectedRadioRig,
        selectedRotator,
        selectedTransmitter,
        groupOfSats,
        satellitePasses,
        satelliteId,
        satelliteData,
        rigData,
        rotatorData,
    } = useSelector((state) => state.targetSatTrack);

    const selectedSatellitePositions = useSelector(state => state.overviewSatTrack.selectedSatellitePositions);

    const [countdown, setCountdown] = useState('');

    function getTransmittersForSatelliteId(satelliteId) {
        if (satelliteId && groupOfSats.length > 0) {
            const satellite = groupOfSats.find(s => s.norad_id === satelliteId);
            if (satellite) {
                return satellite.transmitters || [];
            } else {
                return [];
            }
        }
        return [];
    }

    const handleSatelliteSelect = useCallback((satellite) => {
        dispatch(setSatelliteId(satellite.norad_id));
        dispatch(setAvailableTransmitters(getTransmittersForSatelliteId(satellite.norad_id)));

        // set the tracking state in the backend to the new norad id and leave the state as is
        const data = {
            ...trackingState,
            norad_id: satellite.norad_id,
            group_id: satellite.groups[0].id,
            rig_id: selectedRadioRig,
            rotator_id: selectedRotator,
            transmitter_id: selectedTransmitter,
        };
        dispatch(setTrackingStateInBackend({ socket, data: data}));
    }, [dispatch, socket, trackingState, selectedRadioRig, selectedRotator, selectedTransmitter, groupOfSats]);

    const handleTrackingStop = useCallback(() => {
        const newTrackingState = {
            ...trackingState,
            'rotator_state': "stopped",
            'rig_state': "stopped",
        };
        dispatch(setTrackingStateInBackend({socket, data: newTrackingState}));
    }, [dispatch, socket, trackingState]);

    // Get current active pass or next upcoming pass
    const passInfo = useMemo(() => {
        if (!satellitePasses || satellitePasses.length === 0 || !satelliteId) return null;

        const now = new Date();

        // Find active pass
        const activePass = satellitePasses.find(pass => {
            if (pass.norad_id !== satelliteId) return false;
            const start = new Date(pass.event_start);
            const end = new Date(pass.event_end);
            return now >= start && now <= end;
        });

        if (activePass) {
            return { type: 'active', pass: activePass };
        }

        // Find next upcoming pass
        let nextPass = null;
        let earliestTime = null;

        for (const pass of satellitePasses) {
            if (pass.norad_id === satelliteId) {
                const startTime = new Date(pass.event_start);
                if (startTime > now) {
                    if (!nextPass || startTime < earliestTime) {
                        nextPass = pass;
                        earliestTime = startTime;
                    }
                }
            }
        }

        if (nextPass) {
            return { type: 'upcoming', pass: nextPass };
        }

        return null;
    }, [satellitePasses, satelliteId]);

    // Update countdown every second
    useEffect(() => {
        if (!passInfo) {
            setCountdown('');
            return;
        }

        const updateCountdown = () => {
            const now = new Date();
            const targetTime = passInfo.type === 'active'
                ? new Date(passInfo.pass.event_end)
                : new Date(passInfo.pass.event_start);

            const diff = targetTime - now;

            if (diff <= 0) {
                setCountdown('0s');
                return;
            }

            const days = Math.floor(diff / (1000 * 60 * 60 * 24));
            const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
            const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
            const seconds = Math.floor((diff % (1000 * 60)) / 1000);

            if (days > 0) {
                setCountdown(`${days}d ${hours}h ${minutes}m`);
            } else if (hours > 0) {
                setCountdown(`${hours}h ${minutes}m ${seconds}s`);
            } else if (minutes > 0) {
                setCountdown(`${minutes}m ${seconds}s`);
            } else {
                setCountdown(`${seconds}s`);
            }
        };

        updateCountdown();
        const interval = setInterval(updateCountdown, 1000);

        return () => clearInterval(interval);
    }, [passInfo]);

    return (
        <Box
            sx={{
                // Mobile/Tablet: two-column grid (main area + narrow stop column)
                // Desktop (lg+): single row flex
                display: { xs: 'grid', lg: 'flex' },
                gridTemplateColumns: { xs: '1fr auto' },
                gridTemplateRows: { xs: 'auto auto' },
                columnGap: { xs: 2 },
                rowGap: { xs: 1.5 },
                alignItems: { lg: 'center' },
                gap: { lg: 2 },
                padding: '8px 12px',
                bgcolor: 'background.paper',
                borderBottom: '1px solid',
                borderColor: 'border.main',
                minHeight: { xs: 'auto', lg: '64px' },
                height: { lg: '64px' },
                maxHeight: { lg: '64px' },
            }}
        >
            {/* Search field with autocomplete */}
            <Box
                sx={{
                    gridColumn: { xs: '1 / 2', lg: 'auto' },
                    gridRow: { xs: '1 / 2', lg: 'auto' },
                    width: { lg: '40%' },
                    minWidth: { lg: 250 },
                    maxWidth: { lg: 350 },
                    flexShrink: { lg: 1 },
                }}
            >
                <SatelliteSearchAutocomplete onSatelliteSelect={handleSatelliteSelect} />
            </Box>

            {/* Group + Satellite dropdowns (side-by-side) */}
            <Box
                sx={{
                    gridColumn: { xs: '1 / 2', lg: 'auto' },
                    gridRow: { xs: '2 / 3', lg: 'auto' },
                    display: { xs: 'grid', lg: 'flex' },
                    gridTemplateColumns: { xs: '1fr 1fr' },
                    gap: '16px',
                    flex: { lg: 1 },
                    minWidth: 0,
                }}
            >
                {/* Group selector dropdown */}
                <Box sx={{ minWidth: { xs: 120, sm: 150 }, maxWidth: { lg: 200 }, flex: 1 }}>
                    <GroupDropdown />
                </Box>

                {/* Satellite selector dropdown */}
                <Box sx={{ minWidth: { xs: 120, sm: 180 }, maxWidth: { lg: 280 }, flex: 1 }}>
                    <SatelliteList />
                </Box>
            </Box>

            {/* Pills + Stop (desktop row) OR Stop only (mobile/tablet column) */}
            <Box
                sx={{
                    // On mobile/tablet: right column spanning both rows
                    gridColumn: { xs: '2 / 3', lg: 'auto' },
                    gridRow: { xs: '1 / 3', lg: 'auto' },
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    ml: { lg: 'auto' },
                    flexShrink: 0,
                    justifyContent: { xs: 'center', lg: 'flex-start' },
                }}
            >
                {/* Tracking status badge */}
                {satelliteId && (
                    <Tooltip title={rigData?.tracking || rotatorData?.tracking ? "Tracking active" : "Tracking stopped"}>
                        <Chip
                            icon={rigData?.tracking || rotatorData?.tracking ? <GpsFixedIcon /> : <GpsOffIcon />}
                            label={rigData?.tracking || rotatorData?.tracking ? "Tracking" : "Stopped"}
                            size="small"
                            sx={{
                                display: { xs: 'none', lg: 'flex' },
                                bgcolor: rigData?.tracking || rotatorData?.tracking ? 'success.main' : 'action.hover',
                                color: rigData?.tracking || rotatorData?.tracking ? 'white' : 'text.secondary',
                                fontWeight: 'bold',
                                '& .MuiChip-icon': {
                                    color: rigData?.tracking || rotatorData?.tracking ? 'white' : 'text.secondary',
                                }
                            }}
                        />
                    </Tooltip>
                )}

                {/* Current elevation with trend */}
                {satelliteId && satelliteData?.position && (
                    <Tooltip title={`Elevation: ${satelliteData.position.el?.toFixed(2)}°`}>
                        <Chip
                            icon={
                                selectedSatellitePositions?.[satelliteId]?.trend === 'rising' ? <TrendingUpIcon /> :
                                selectedSatellitePositions?.[satelliteId]?.trend === 'falling' ? <TrendingDownIcon /> :
                                selectedSatellitePositions?.[satelliteId]?.trend === 'peak' ? <HorizontalRuleIcon /> :
                                null
                            }
                            label={`El: ${satelliteData.position.el?.toFixed(1)}°`}
                            size="small"
                            sx={{
                                display: { xs: 'none', lg: 'flex' },
                                bgcolor: satelliteData.position.el < 0 ? 'action.hover' :
                                         satelliteData.position.el < 10 ? 'error.main' :
                                         satelliteData.position.el < 45 ? 'warning.main' : 'success.main',
                                color: satelliteData.position.el < 0 ? 'text.secondary' : 'white',
                                fontWeight: 'bold',
                                fontFamily: 'monospace',
                                '& .MuiChip-icon': {
                                    color: satelliteData.position.el < 0 ? 'text.secondary' :
                                           selectedSatellitePositions?.[satelliteId]?.trend === 'rising' ? 'info.light' :
                                           selectedSatellitePositions?.[satelliteId]?.trend === 'falling' ? 'error.light' :
                                           selectedSatellitePositions?.[satelliteId]?.trend === 'peak' ? 'warning.light' :
                                           'white',
                                }
                            }}
                        />
                    </Tooltip>
                )}

                {/* Pass countdown */}
                {passInfo && countdown && (
                    <Tooltip title={passInfo.type === 'active' ? 'Current pass ending' : 'Next pass starting'}>
                        <Chip
                            icon={passInfo.type === 'active' ? <AccessTimeIcon /> : <TrendingUpIcon />}
                            label={countdown}
                            size="small"
                            sx={{
                                display: { xs: 'none', lg: 'flex' },
                                bgcolor: passInfo.type === 'active' ? 'success.main' : 'info.main',
                                color: 'white',
                                fontWeight: 'bold',
                                fontFamily: 'monospace',
                                '& .MuiChip-icon': {
                                    color: 'white',
                                }
                            }}
                        />
                    </Tooltip>
                )}

                {/* Stop tracking button */}
                {satelliteId && (
                    <Button
                        variant="contained"
                        color="error"
                        startIcon={<StopIcon />}
                        disabled={rigData?.tracking !== true && rotatorData?.tracking !== true}
                        onClick={handleTrackingStop}
                        size="small"
                        sx={{
                            textTransform: 'none',
                            fontWeight: 'bold',
                            minWidth: { xs: 40, sm: 'auto' },
                            px: { xs: 1, sm: 2 },
                            height: 36,
                        }}
                    >
                        <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>
                            {t('satellite_selector.stop_tracking')}
                        </Box>
                    </Button>
                )}
            </Box>
        </Box>
    );
});

export default TargetSatelliteSelectorBar;
