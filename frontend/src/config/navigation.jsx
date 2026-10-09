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

import EngineeringIcon from '@mui/icons-material/Engineering';
import AddHomeIcon from '@mui/icons-material/AddHome';
import {PreferenceVerticalIcon} from "hugeicons-react";
import InfoIcon from '@mui/icons-material/Info';
import MicrowaveIcon from '@mui/icons-material/Microwave';
import WavesIcon from '@mui/icons-material/Waves';
import VideocamIcon from '@mui/icons-material/Videocam';
import CurrencyBitcoinIcon from '@mui/icons-material/CurrencyBitcoin';
import SatelliteAltIcon from '@mui/icons-material/SatelliteAlt';
import i18n from '../i18n/config.js';
import { TleIcon } from '../components/common/custom-icons.jsx';
import { Box, CircularProgress } from '@mui/material';
import SyncIcon from '@mui/icons-material/Sync';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import FiberManualRecordIcon from '@mui/icons-material/FiberManualRecord';
import EventNoteIcon from '@mui/icons-material/EventNote';
import { useSelector } from 'react-redux';

// Helper component to wrap icons with overlay indicators
const IconWithOverlay = ({ children, showOverlay = false, overlayType = 'spinner', showLeftOverlay = false, leftOverlayType = null }) => {
    return (
        <Box sx={{ position: 'relative', display: 'inline-flex' }}>
            {children}
            {/* Left overlay (e.g., recording indicator) */}
            {showLeftOverlay && leftOverlayType && (
                <Box
                    sx={{
                        position: 'absolute',
                        top: -4,
                        left: -4,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                    }}
                >
                    {leftOverlayType === 'recording' && (
                        <Box
                            sx={{
                                backgroundColor: 'rgba(244, 67, 54, 0.3) !important',
                                borderRadius: '50%',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                padding: '3px',
                            }}
                        >
                            <FiberManualRecordIcon
                                sx={{
                                    fontSize: 10,
                                    color: '#F44336 !important',
                                    fill: '#F44336 !important',
                                    animation: 'pulse 1.5s ease-in-out infinite',
                                    '@keyframes pulse': {
                                        '0%, 100%': { opacity: 1 },
                                        '50%': { opacity: 0.4 },
                                    }
                                }}
                            />
                        </Box>
                    )}
                </Box>
            )}
            {/* Right overlay (e.g., streaming, sync indicators) */}
            {showOverlay && (
                <Box
                    sx={{
                        position: 'absolute',
                        top: -4,
                        right: -4,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                    }}
                >
                    {overlayType === 'spinner' ? (
                        <Box
                            sx={{
                                backgroundColor: 'rgba(33, 150, 243, 0.3) !important',
                                borderRadius: '50%',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                padding: '2px',
                            }}
                        >
                            <CircularProgress
                                size={12}
                                thickness={6}
                                sx={{
                                    color: '#2196F3 !important',
                                    '& .MuiCircularProgress-circle': {
                                        stroke: '#2196F3 !important',
                                    }
                                }}
                            />
                        </Box>
                    ) : overlayType === 'sync' ? (
                        <Box
                            sx={{
                                backgroundColor: 'rgba(255, 152, 0, 0.3) !important',
                                borderRadius: '50%',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                padding: '2px',
                            }}
                        >
                            <SyncIcon
                                sx={{
                                    fontSize: 12,
                                    color: '#FF9800 !important',
                                    fill: '#FF9800 !important',
                                    animation: 'spin 1s linear infinite',
                                    '@keyframes spin': {
                                        '0%': { transform: 'rotate(0deg)' },
                                        '100%': { transform: 'rotate(360deg)' },
                                    }
                                }}
                            />
                        </Box>
                    ) : overlayType === 'play' ? (
                        <Box
                            sx={{
                                backgroundColor: 'rgba(76, 175, 80, 0.3) !important',
                                borderRadius: '50%',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                padding: '2px',
                            }}
                        >
                            <PlayArrowIcon
                                sx={{
                                    fontSize: 12,
                                    color: '#4CAF50 !important',
                                    fill: '#4CAF50 !important',
                                }}
                            />
                        </Box>
                    ) : overlayType === 'new' ? (
                        <Box
                            sx={{
                                backgroundColor: 'rgba(244, 67, 54, 0.3) !important',
                                borderRadius: '50%',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                padding: '3px',
                            }}
                        >
                            <FiberManualRecordIcon
                                sx={{
                                    fontSize: 10,
                                    color: '#F44336 !important',
                                    fill: '#F44336 !important',
                                }}
                            />
                        </Box>
                    ) : null}
                </Box>
            )}
        </Box>
    );
};

// Wrapper component for WavesIcon that reads Redux state
const WaterfallIconWithStatus = () => {
    const isStreaming = useSelector((state) => state.waterfall?.isStreaming);
    const isRecording = useSelector((state) => state.waterfall?.isRecording);

    return (
        <IconWithOverlay
            showOverlay={isStreaming}
            overlayType="play"
            showLeftOverlay={isRecording}
            leftOverlayType="recording"
        >
            <WavesIcon />
        </IconWithOverlay>
    );
};

// Wrapper component for TleIcon that reads Redux state
const TleIconWithStatus = () => {
    const isSynchronizing = useSelector((state) => state.syncSatellite?.synchronizing);

    return (
        <IconWithOverlay showOverlay={isSynchronizing} overlayType="sync">
            <TleIcon />
        </IconWithOverlay>
    );
};

// Wrapper component for EventNoteIcon that reads Redux state
const SchedulerIconWithStatus = () => {
    const observations = useSelector((state) => state.scheduler?.observations || []);

    // Check if any observation has status "running"
    const hasActiveObservation = observations.some(obs => obs.status === 'running');

    return (
        <IconWithOverlay showOverlay={hasActiveObservation} overlayType="play">
            <EventNoteIcon />
        </IconWithOverlay>
    );
};

export const getNavigation = () => [
    {
        kind: 'header',
        title: 'BitLink21',
    },
    {
        segment: '',
        title: 'Link',
        icon: <SatelliteAltIcon />,
    },
    {
        segment: 'bitlink21/payments',
        title: 'Bitcoin & Lightning',
        icon: <CurrencyBitcoinIcon />,
    },
    {
        kind: 'header',
        title: 'Radio',
    },
    {
        segment: 'waterfall',
        title: 'Radio (classic)',
        icon: <WaterfallIconWithStatus />,
    },
    {kind: 'divider'},
    {
        kind: 'header',
        title: i18n.t('hardware', { ns: 'navigation' }),
    },
    // {
    //     segment: 'hardware/cameras',
    //     title: i18n.t('cameras', { ns: 'navigation' }),
    //     icon: <VideocamIcon/>,
    // },
    {
        segment: 'hardware/sdrs',
        title: i18n.t('sdrs', { ns: 'navigation' }),
        icon: <MicrowaveIcon/>,
    },
    {kind: 'divider'},
    {
        kind: 'header',
        title: i18n.t('settings', { ns: 'navigation' }),
    },
    {
        segment: 'settings/preferences',
        title: i18n.t('preferences', { ns: 'navigation' }),
        icon: <PreferenceVerticalIcon/>,
    },
    {
        segment: 'settings/location',
        title: i18n.t('location', { ns: 'navigation' }),
        icon: <AddHomeIcon/>,
    },
    // {
    //     segment: 'settings/users',
    //     title: 'Users',
    //     icon: <PeopleIcon/>,
    // },
    {
        segment: 'settings/maintenance',
        title: i18n.t('maintenance', { ns: 'navigation' }),
        icon: <EngineeringIcon/>,
    },
    {
        segment: 'settings/about',
        title: i18n.t('about', { ns: 'navigation' }),
        icon: <InfoIcon/>,
    },
];

// Keep NAVIGATION for backward compatibility but make it dynamic
export const NAVIGATION = getNavigation();
