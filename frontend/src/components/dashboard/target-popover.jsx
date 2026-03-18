
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

import * as React from "react";
import {
    Box,
    IconButton,
    Popover,
    Typography,
    Divider,
    Chip,
    Grid,
    Button,
    Card,
    Link,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { useState, useRef, useEffect, useMemo } from "react";
import { useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import Tooltip from "@mui/material/Tooltip";
import { useTranslation } from 'react-i18next';
import SatelliteAltIcon from '@mui/icons-material/SatelliteAlt';
import InfoIcon from '@mui/icons-material/Info';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import EditIcon from '@mui/icons-material/Edit';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import TrendingDownIcon from '@mui/icons-material/TrendingDown';
import { humanizeFrequency, formatLegibleDateTime, betterStatusValue } from "../common/common.jsx";
import SatSelectorIsland from "../target/satellite-selector.jsx";
import { SatellitePassTimeline } from "../target/timeline-main.jsx";
import TransmittersDialog from "../satellites/transmitters-dialog.jsx";
import { calculateElevationCurve } from "../../utils/elevation-curve-calculator.js";
import { useUserTimeSettings } from '../../hooks/useUserTimeSettings.jsx';
import { formatDate as formatDateHelper } from '../../utils/date-time.js';

const SatelliteInfoPopover = () => {
    const theme = useTheme();
    const buttonRef = useRef(null);
    const [anchorEl, setAnchorEl] = useState(null);
    const [transmittersDialogOpen, setTransmittersDialogOpen] = useState(false);
    const navigate = useNavigate();
    const { t } = useTranslation('dashboard');
    const { timezone, locale } = useUserTimeSettings();

    // Get satellite data from Redux store
    const { satelliteData, trackingState, rotatorData, satellitePasses, activePass } = useSelector(state => state.targetSatTrack);
    const groundStationLocation = useSelector((state) => state.location.location);

    // Combine details and transmitters for the TransmittersTable component
    const targetSatelliteData = satelliteData.details ? {
        ...satelliteData.details,
        transmitters: satelliteData.transmitters || []
    } : null;

    const handleClick = (event) => {
        setAnchorEl(event.currentTarget);
    };

    const handleClose = () => {
        setAnchorEl(null);
    };

    const handleNavigateToSatelliteInfo = () => {
        if (satelliteData.details.norad_id) {
            navigate(`/satellite/${satelliteData.details.norad_id}`);
            handleClose(); // Close the popover after navigation
        }
    };

    const open = Boolean(anchorEl);

    // Format date helper - use common function
    const formatDate = (dateString) => {
        if (!dateString) return 'N/A';
        return formatDateHelper(dateString, { timezone, locale });
    };

    const getTooltipText = () => {
        const satName = satelliteData.details.name || 'No satellite selected';
        if (!satelliteData.details.norad_id) {
            return `Satellite Info: ${satName}`;
        }

        const elevation = satelliteData.position.el;
        const visibilityText = elevation > 0 ? 'Visible' : 'Below horizon';

        return `Satellite Info: ${satName} (${visibilityText}, El: ${elevation?.toFixed(1)}°)`;
    };

    const isTrackingActive = trackingState.norad_id === satelliteData.details.norad_id;

    // Get icon color based on satellite visibility
    const getSatelliteIconColor = () => {
        if (!satelliteData.details.norad_id) {
            return 'text.secondary'; // Grey when no satellite selected
        }

        const elevation = satelliteData.position.el;
        const minElevation = rotatorData.minel ?? 0;

        if (elevation < 0) {
            return 'error.main'; // Red when satellite is below horizon
        } else if (elevation < minElevation) {
            return 'status.polling'; // Orange when satellite is below minimum elevation limit
        } else if (isTrackingActive) {
            return 'success.main'; // Bright green when actively tracking and above minimum elevation
        } else {
            return 'info.main'; // Light blue when satellite is well above minimum elevation
        }
    };

    // Get satellite status information
    const getSatelliteStatus = (theme) => {
        if (!satelliteData.details.norad_id) {
            return {
                status: 'No Satellite',
                color: 'text.secondary',
                backgroundColor: 'action.hover',
                icon: <InfoIcon />,
                description: 'No satellite selected'
            };
        }

        const elevation = satelliteData.position.el;
        const minElevation = rotatorData.minel ?? 0;

        if (elevation < 0) {
            return {
                status: 'Below Horizon',
                color: 'error.main',
                backgroundColor: theme.palette.mode === 'dark'
                    ? `${theme.palette.error.main}25` // 15% opacity on dark
                    : 'error.light',
                icon: <VisibilityOffIcon />,
                description: 'Satellite is not visible from current location'
            };
        } else if (elevation < minElevation) {
            return {
                status: 'Low Elevation',
                color: 'warning.main',
                backgroundColor: theme.palette.mode === 'dark'
                    ? `${theme.palette.warning.main}25` // 15% opacity on dark
                    : 'warning.light',
                icon: <TrendingDownIcon />,
                description: `Satellite is below minimum elevation limit (${minElevation}°)`
            };
        } else if (isTrackingActive) {
            return {
                status: 'Actively Tracking',
                color: 'success.main',
                backgroundColor: theme.palette.mode === 'dark'
                    ? `${theme.palette.success.main}25` // 15% opacity on dark
                    : 'success.light',
                icon: <SatelliteAltIcon />,
                description: 'Currently tracking this satellite'
            };
        } else {
            return {
                status: 'Visible',
                color: 'info.main',
                backgroundColor: theme.palette.mode === 'dark'
                    ? `${theme.palette.info.main}25` // 15% opacity on dark
                    : 'info.light',
                icon: <VisibilityIcon />,
                description: 'Satellite is well positioned above horizon'
            };
        }
    };

    // Get elevation color based on value
    const getElevationColor = (elevation) => {
        const minElevation = rotatorData.minel ?? 0;

        if (elevation < 0) return 'error.main'; // Red - below horizon
        if (elevation < minElevation) return 'warning.main'; // Orange - below minimum elevation limit
        if (elevation < 45) return 'info.main'; // Light blue - above minimum but not optimal
        return 'success.main'; // Green - optimal elevation
    };

    // Component for displaying numerical values with monospace font
    const NumericValue = ({ children, color }) => (
        <span style={{
            fontFamily: 'Monaco, Consolas, "Courier New", monospace',
            color: color || 'inherit',
            fontWeight: 'bold'
        }}>
            {children}
        </span>
    );

    const statusInfo = getSatelliteStatus(theme);

    // Determine the current active pass
    const getCurrentActivePass = () => {
        if (!satellitePasses || satellitePasses.length === 0) return null;
        if (!satelliteData.details?.norad_id) return null;

        const now = new Date();
        return satellitePasses.find(pass => {
            if (pass.norad_id !== satelliteData.details.norad_id) {
                return false;
            }
            const passStart = new Date(pass.event_start);
            const passEnd = new Date(pass.event_end);
            return now >= passStart && now <= passEnd;
        });
    };

    const currentActivePass = getCurrentActivePass();

    // Calculate elevation curve for the active pass on-the-fly
    const enhancedActivePass = useMemo(() => {
        if (!currentActivePass || !satelliteData.details.tle1 || !groundStationLocation) {
            return currentActivePass;
        }

        // Calculate elevation curve for this single pass
        const elevationCurve = calculateElevationCurve(
            satelliteData.details, // Has tle1, tle2, norad_id
            groundStationLocation,
            currentActivePass.event_start,
            currentActivePass.event_end,
            30 // Extend start by 30 minutes for better curve display
        );

        return {
            ...currentActivePass,
            elevation_curve: elevationCurve
        };
    }, [currentActivePass, satelliteData.details.tle1, satelliteData.details.tle2, groundStationLocation]);

    const showTimeline = satelliteData.details.norad_id && enhancedActivePass;

    // Memoize the next pass calculation to prevent unnecessary recalculations
    const nextPass = useMemo(() => {
        if (!satellitePasses || satellitePasses.length === 0 || !satelliteData.details.norad_id) return null;

        const now = new Date();

        // Find the earliest upcoming pass without creating a large intermediate array
        let earliestPass = null;
        let earliestTime = null;

        for (const pass of satellitePasses) {
            if (pass.norad_id === satelliteData.details.norad_id) {
                const startTime = new Date(pass.event_start);
                if (startTime > now) {
                    if (!earliestPass || startTime < earliestTime) {
                        earliestPass = pass;
                        earliestTime = startTime;
                    }
                }
            }
        }

        return earliestPass;
    }, [satellitePasses, satelliteData.details.norad_id]);

    // Countdown Component - extracted outside to use memoized nextPass
    const NextPassCountdown = React.memo(({ pass }) => {
        // We intentionally read from outer scope to react to store updates over time
        // without relying only on props that don't change as time advances.
        const selectedNoradId = satelliteData.details?.norad_id;

        // Utility: find earliest future pass for the selected satellite
        const findNextFuturePass = React.useCallback(() => {
            if (!selectedNoradId) return null;
            const now = new Date();
            let earliest = null;
            let earliestTime = null;
            for (const p of satellitePasses || []) {
                if (p.norad_id === selectedNoradId && p?.event_start) {
                    const st = new Date(p.event_start);
                    if (!isNaN(st) && st > now) {
                        if (!earliest || st < earliestTime) {
                            earliest = p;
                            earliestTime = st;
                        }
                    }
                }
            }
            return earliest;
        }, [selectedNoradId, satellitePasses]);

        // Local pass state that can advance to the next pass when current has started
        const [currentPass, setCurrentPass] = useState(pass || findNextFuturePass());
        const passId = currentPass?.id;
        const passStartTime = currentPass?.event_start;

        // Calculate initial countdown value to avoid empty state
        const calculateCountdown = (startTimeStr) => {
            if (!selectedNoradId) return 'No satellite selected';
            if (!startTimeStr) return 'No upcoming passes';

            const now = new Date();
            const startTime = new Date(startTimeStr);
            if (isNaN(startTime)) return 'Invalid pass start time';

            const diff = startTime - now;

            if (diff <= 0) {
                // Try to advance to the next future pass
                const nxt = findNextFuturePass();
                if (nxt && nxt.id !== currentPass?.id) {
                    setCurrentPass(nxt);
                    // Recalculate based on the new pass
                    return calculateCountdown(nxt.event_start);
                }
                // No future pass found — report a helpful message
                return 'No upcoming passes (schedule not updated)';
            }

            const days = Math.floor(diff / (1000 * 60 * 60 * 24));
            const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
            const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
            const seconds = Math.floor((diff % (1000 * 60)) / 1000);

            if (days > 0) {
                return `${days}d ${hours}h ${minutes}m`;
            } else if (hours > 0) {
                return `${hours}h ${minutes}m ${seconds}s`;
            } else if (minutes > 0) {
                return `${minutes}m ${seconds}s`;
            } else {
                return `${seconds}s`;
            }
        };

        const [countdown, setCountdown] = useState(() => calculateCountdown(passStartTime));

        // Keep local pass in sync if parent prop changes (e.g., selected satellite changes)
        useEffect(() => {
            setCurrentPass(pass || findNextFuturePass());
        }, [pass, findNextFuturePass]);

        // Recompute countdown every second; also attempt to advance to the next pass if needed
        useEffect(() => {
            const updateCountdown = () => {
                setCountdown(calculateCountdown(currentPass?.event_start));
            };

            updateCountdown();
            const interval = setInterval(updateCountdown, 1000);
            return () => clearInterval(interval);
        }, [passId, currentPass?.event_start, selectedNoradId, findNextFuturePass]);

        if (!selectedNoradId) {
            return (
                <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
                    No satellite selected
                </Typography>
            );
        }

        if (!currentPass) {
            return (
                <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
                    No upcoming passes
                </Typography>
            );
        }

        return (
            <Box sx={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 1
            }}>
                <Typography variant="body2" color="text.secondary">
                    Next pass in
                </Typography>
                <Typography
                    variant="h4"
                    sx={{
                        fontFamily: 'Monaco, Consolas, "Courier New", monospace',
                        fontWeight: 'bold',
                        color: 'info.light'
                    }}
                >
                    {countdown}
                </Typography>
                <Typography variant="caption" color="text.disabled">
                    {formatLegibleDateTime(currentPass.event_start, timezone, locale)}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                    Peak elevation: {currentPass.peak_altitude?.toFixed(1)}°
                </Typography>
            </Box>
        );
    });

    return (
        <>
            <Box sx={{ position: 'relative', display: 'inline-block' }}>
                <Tooltip title={getTooltipText()}>
                    <IconButton
                        ref={buttonRef}
                        onClick={handleClick}
                        size="small"
                        sx={{
                            width: 40,
                            color: getSatelliteIconColor(),
                            '&:hover': {
                                backgroundColor: 'overlay.light'
                            },
                            '& svg': {
                                height: '75%',
                            }
                        }}
                    >
                        <SatelliteAltIcon />
                    </IconButton>
                </Tooltip>

                {/* Elevation Overlay */}
                {satelliteData.details.norad_id && (
                    <Box
                        sx={{
                            position: 'absolute',
                            bottom: 5,
                            right: 6,
                            backgroundColor: 'overlay.dark',
                            border: `1px solid ${getElevationColor(satelliteData.position.el)}`,
                            borderRadius: '3px',
                            paddingLeft: 0.6,
                            paddingTop: 0.2,
                            minWidth: 22,
                            width: 30,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            pointerEvents: 'none',
                            zIndex: 1
                        }}
                    >
                        <Typography
                            variant="caption"
                            sx={{
                                color: getElevationColor(satelliteData.position.el),
                                fontSize: '0.65rem',
                                fontWeight: 'bold',
                                fontFamily: 'Monaco, Consolas, "Courier New", monospace',
                                lineHeight: 1
                            }}
                        >
                            {satelliteData.position.el >= 0 ? '+' : ''}{satelliteData.position.el?.toFixed(0)}°
                        </Typography>
                    </Box>
                )}

            </Box>

            <Popover
                sx={{
                    '& .MuiPaper-root': {
                        borderRadius: 0,
                    }
                }}
                open={open}
                anchorEl={anchorEl}
                onClose={handleClose}
                anchorOrigin={{
                    vertical: 'bottom',
                    horizontal: 'right',
                }}
                transformOrigin={{
                    vertical: 'top',
                    horizontal: 'right',
                }}
            >
                <Box sx={{
                    borderRadius: 0,
                    border: '1px solid',
                    borderColor: 'border.main',
                    p: 1,
                    minWidth: 320,
                    maxWidth: 350,
                    backgroundColor: 'background.paper',
                    color: 'text.primary',
                }}>
                    {/* Status Banner with Satellite Name */}
                    <Box sx={{
                        mb: 1,
                        p: 1.5,
                        borderRadius: 1,
                        backgroundColor: statusInfo.backgroundColor,
                        border: `1px solid ${statusInfo.color}`,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 1
                    }}>
                        <Box sx={{ flexGrow: 1 }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', mb: 0.5, gap: 1 }}>
                                <Typography variant="h6" sx={{
                                    fontWeight: 'bold',
                                    color: 'text.primary',
                                    fontSize: '1.1rem'
                                }}>
                                    {satelliteData.details.name || 'No Satellite Selected'}
                                </Typography>
                            </Box>
                            <Typography variant="subtitle1" sx={{
                                color: statusInfo.color,
                                fontWeight: 'bold',
                                mb: 0.25,
                                fontSize: '0.9rem'
                            }}>
                                {statusInfo.status}
                            </Typography>
                            <Typography variant="body2" sx={{
                                color: 'text.secondary',
                                fontSize: '0.8rem'
                            }}>
                                {statusInfo.description}
                            </Typography>
                        </Box>
                        {satelliteData.details.norad_id && (
                            <Box sx={{ textAlign: 'right' }}>
                                <Typography variant="body2" sx={{ color: 'text.secondary', fontSize: '0.75rem' }}>
                                    Elevation
                                </Typography>
                                <Typography variant="h6" sx={{
                                    color: getElevationColor(satelliteData.position.el),
                                    fontWeight: 'bold',
                                    fontFamily: 'Monaco, Consolas, "Courier New", monospace'
                                }}>
                                    {satelliteData.position.el?.toFixed(1)}°
                                </Typography>
                            </Box>
                        )}
                    </Box>

                    {satelliteData.details.norad_id ? (
                        <>
                            {/* Position Information */}
                            <Box sx={{
                                mb: 1,
                                p: 1.5,
                                borderRadius: 1,
                                backgroundColor: 'action.hover'
                            }}>
                                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                                    <Typography variant="subtitle2" sx={{ color: 'info.light', fontWeight: 'bold' }}>
                                        {t('target_popover.sections.current_position')}
                                    </Typography>
                                    <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
                                        <Link
                                            component="button"
                                            onClick={handleNavigateToSatelliteInfo}
                                            sx={{
                                                color: 'text.disabled',
                                                fontSize: '0.7rem',
                                                textDecoration: 'none',
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: 0.3,
                                                '&:hover': {
                                                    color: 'info.light',
                                                    textDecoration: 'underline',
                                                },
                                                cursor: 'pointer',
                                            }}
                                        >
                                            View info
                                            <OpenInNewIcon sx={{ fontSize: '0.75rem' }} />
                                        </Link>
                                        <Typography sx={{ color: 'text.disabled', fontSize: '0.7rem' }}>•</Typography>
                                        <Link
                                            component="button"
                                            onClick={() => {
                                                setTransmittersDialogOpen(true);
                                                handleClose();
                                            }}
                                            sx={{
                                                color: 'text.disabled',
                                                fontSize: '0.7rem',
                                                textDecoration: 'none',
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: 0.3,
                                                '&:hover': {
                                                    color: 'info.light',
                                                    textDecoration: 'underline',
                                                },
                                                cursor: 'pointer',
                                            }}
                                        >
                                            Edit transmitters
                                            <EditIcon sx={{ fontSize: '0.75rem' }} />
                                        </Link>
                                    </Box>
                                </Box>
                                <Grid container spacing={1}>
                                    <Grid size={4}>
                                        <Typography variant="body2" component="div" sx={{color: 'text.secondary'}}>
                                            <strong>{t('target_popover.latitude')}</strong>
                                        </Typography>
                                        <Typography variant="body2" component="div">
                                            <NumericValue
                                                color="info.light">{satelliteData.position.lat?.toFixed(4)}°</NumericValue>
                                        </Typography>
                                    </Grid>
                                    <Grid size={4}>
                                        <Typography variant="body2" component="div" sx={{color: 'text.secondary'}}>
                                            <strong>{t('target_popover.longitude')}</strong>
                                        </Typography>
                                        <Typography variant="body2" component="div">
                                            <NumericValue
                                                color="info.light">{satelliteData.position.lon?.toFixed(4)}°</NumericValue>
                                        </Typography>
                                    </Grid>
                                    <Grid size={4}>
                                        <Typography variant="body2" component="div" sx={{color: 'text.secondary'}}>
                                            <strong>{t('target_popover.azimuth')}</strong>
                                        </Typography>
                                        <Typography variant="body2" component="div">
                                            <NumericValue
                                                color="secondary.light">{satelliteData.position.az?.toFixed(2)}°</NumericValue>
                                        </Typography>
                                    </Grid>
                                    <Grid size={4}>
                                        <Typography variant="body2" component="div" sx={{color: 'text.secondary'}}>
                                            <strong>{t('target_popover.altitude')}</strong>
                                        </Typography>
                                        <Typography variant="body2" component="div">
                                            <NumericValue
                                                color="success.light">{(satelliteData.position.alt / 1000)?.toFixed(2)} km</NumericValue>
                                        </Typography>
                                    </Grid>
                                    <Grid size={4}>
                                        <Typography variant="body2" component="div" sx={{color: 'text.secondary'}}>
                                            <strong>{t('target_popover.velocity')}</strong>
                                        </Typography>
                                        <Typography variant="body2" component="div">
                                            <NumericValue
                                                color="warning.light">{satelliteData.position.vel?.toFixed(2)} km/s</NumericValue>
                                        </Typography>
                                    </Grid>
                                    <Grid size={4}>
                                        <Typography variant="body2" component="div" sx={{color: 'text.secondary'}}>
                                            <strong>{t('target_popover.elevation')}</strong>
                                        </Typography>
                                        <Typography variant="body2" component="div">
                                            <NumericValue
                                                color={getElevationColor(satelliteData.position.el)}>{satelliteData.position.el?.toFixed(2)}°</NumericValue>
                                        </Typography>
                                    </Grid>
                                </Grid>
                            </Box>

                        </>
                    ) : null}

                    {/* Active Pass Timeline - show when there's an active pass, otherwise show countdown */}
                    {satelliteData.details.norad_id && (
                        <Box sx={{ mb: 1, height: '150px' }}>
                            {showTimeline ? (
                                <SatellitePassTimeline
                                    singlePassMode={true}
                                    passId={enhancedActivePass.id}
                                    passesOverride={[enhancedActivePass]}
                                    showSunShading={false}
                                    showSunMarkers={false}
                                    satelliteName={satelliteData.details.name}
                                    showTitleBar={false}
                                    showGeostationarySatellites={true}
                                />
                            ) : (
                                <Box
                                    sx={{
                                        height: '100%',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        backgroundColor: 'action.hover',
                                        borderRadius: 1,
                                        border: '1px dashed',
                                        borderColor: 'divider',
                                    }}
                                >
                                    <NextPassCountdown pass={nextPass} />
                                </Box>
                            )}
                        </Box>
                    )}

                    {/* Satellite Selector */}
                    <Box sx={{ mb: 0 }}>
                        <SatSelectorIsland
                            initialNoradId={satelliteData.details.norad_id}
                            initialGroupId={trackingState.group_id}
                        />
                    </Box>
                </Box>
            </Popover>

            {/* Transmitters Dialog */}
            <TransmittersDialog
                open={transmittersDialogOpen}
                onClose={() => setTransmittersDialogOpen(false)}
                title={`${satelliteData.details?.name || ''} - Transmitters`}
                satelliteData={targetSatelliteData}
                variant="elevated"
            />
        </>
    );
};

export default SatelliteInfoPopover;
