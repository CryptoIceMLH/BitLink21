
import NewReleasesIcon from '@mui/icons-material/NewReleases';
import { keyframes } from '@emotion/react';
import { Backdrop, Box, Typography, Button, CircularProgress } from "@mui/material";
import { useSelector, useDispatch } from "react-redux";
import { clearVersionChangeFlag } from './version-slice.jsx';
import { useEffect, useState } from "react";
import { useTranslation } from 'react-i18next';

// Minimal animations
const fadeIn = keyframes`
    from {
        opacity: 0;
        transform: translateY(10px);
    }
    to {
        opacity: 1;
        transform: translateY(0);
    }
`;


const COUNTDOWN_DURATION = 5; // 5 seconds

function VersionUpdateOverlay() {
    const dispatch = useDispatch();
    const { t } = useTranslation('dashboard');
    const { hasVersionChanged, data } = useSelector((state) => state.version);
    const [countdown, setCountdown] = useState(COUNTDOWN_DURATION);
    const [intervalId, setIntervalId] = useState(null);

    useEffect(() => {
        if (hasVersionChanged) {
            // Don't show overlay if version hasn't changed
            if (!hasVersionChanged) {
                return null;
            }

            console.log('Version has changed!', data?.version);

            // Start the countdown interval
            const interval = setInterval(() => {
                setCountdown((prev) => {
                    if (prev <= 1) {
                        clearInterval(interval);
                        window.location.reload();
                        return 0;
                    }
                    return prev - 1;
                });
            }, 1000);

            setIntervalId(interval);

            // Cleanup on unmount
            return () => {
                clearInterval(interval);
            };
        }
    }, [hasVersionChanged, data]);

    const handleRefresh = () => {
        // Clear timer
        if (intervalId) clearInterval(intervalId);

        // Clear the version change flag
        dispatch(clearVersionChangeFlag());
        // Reload the page to get the new version
        window.location.reload();
    };

    const handleDismiss = () => {
        // Clear timer
        if (intervalId) clearInterval(intervalId);

        // Just clear the flag without reloading
        dispatch(clearVersionChangeFlag());
    };

    // Calculate progress for circular progress (100% at start, 0% at end)
    const progress = countdown <= 0 ? 0 : Math.max(0, (countdown / COUNTDOWN_DURATION) * 100);

    // Determine color based on countdown
    const statusColor = countdown > 2 ? '#4caf50' : countdown > 1 ? '#ff9800' : '#d32f2f';

    return (
        <Backdrop
            open={true}
            sx={{
                zIndex: (theme) => theme.zIndex.drawer + 1,
                backgroundColor: 'rgba(0, 0, 0, 0.5)',
                backdropFilter: 'blur(4px)'
            }}
        >
            <Box
                sx={{
                    animation: `${fadeIn} 0.2s ease-out`,
                    backgroundColor: '#2a2a2a',
                    border: `1px solid ${statusColor}`,
                    borderRadius: 1,
                    padding: 3,
                    minWidth: 320,
                    maxWidth: 370,
                    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.4)',
                }}
            >
                {/* Header */}
                <Box sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 2,
                    mb: 2,
                }}>
                    <NewReleasesIcon sx={{ fontSize: 24, color: statusColor }} />
                    <Box sx={{ flex: 1 }}>
                        <Typography
                            variant="subtitle1"
                            sx={{
                                color: '#ffffff',
                                fontWeight: 500,
                                mb: 0.5,
                                fontSize: '1rem'
                            }}
                        >
                            {t('version_update.new_version_available')}
                        </Typography>
                        <Typography
                            variant="body2"
                            sx={{
                                color: '#b0b0b0',
                                fontSize: '0.875rem'
                            }}
                        >
                            {t('version_update.version', { version: data?.version })}
                        </Typography>
                    </Box>
                </Box>

                {/* Progress indicator with countdown */}
                <Box
                    sx={{
                        mb: 2,
                    }}
                >
                    <Box
                        sx={{
                            width: '100%',
                            height: 2,
                            backgroundColor: '#424242',
                            borderRadius: 1,
                            overflow: 'hidden',
                            position: 'relative',
                            mb: 1.5
                        }}
                    >
                        <Box
                            sx={{
                                height: '100%',
                                width: `${progress}%`,
                                backgroundColor: statusColor,
                                borderRadius: progress > 0 ? 1 : 0,
                                transition: 'background-color 0.3s ease',
                            }}
                        />
                    </Box>

                    <Typography
                        variant="body2"
                        sx={{
                            color: statusColor,
                            fontSize: '0.875rem',
                            textAlign: 'center'
                        }}
                    >
                        {countdown > 0 ? t('version_update.refreshing_in', { seconds: countdown }) : t('version_update.refreshing_now')}
                    </Typography>
                </Box>

                {/* Action buttons */}
                <Box sx={{
                    display: 'flex',
                    gap: 1.5,
                    justifyContent: 'stretch'
                }}>
                    <Button
                        variant="outlined"
                        onClick={handleDismiss}
                        disabled={countdown === 0}
                        fullWidth
                        size="small"
                        sx={{
                            color: '#b0b0b0',
                            borderColor: '#424242',
                            '&:hover': {
                                borderColor: '#757575',
                                backgroundColor: 'rgba(255, 255, 255, 0.05)'
                            },
                            '&:disabled': {
                                borderColor: '#333333',
                                color: '#666666'
                            },
                            textTransform: 'none',
                            fontWeight: 500,
                            fontSize: '0.8rem',
                            py: 0.5
                        }}
                    >
                        {t('version_update.cancel')}
                    </Button>
                    <Button
                        variant="contained"
                        onClick={handleRefresh}
                        disabled={countdown === 0}
                        fullWidth
                        size="small"
                        sx={{
                            backgroundColor: statusColor,
                            color: '#ffffff',
                            '&:hover': {
                                backgroundColor: countdown > 2 ? '#45a049' : countdown > 1 ? '#f57c00' : '#d32f2f',
                                filter: 'brightness(0.9)'
                            },
                            '&:disabled': {
                                backgroundColor: '#666666'
                            },
                            textTransform: 'none',
                            fontWeight: 500,
                            fontSize: '0.8rem',
                            py: 0.5
                        }}
                    >
                        {t('version_update.refresh_now')}
                    </Button>
                </Box>

                {/* Status text */}
                <Typography
                    variant="caption"
                    sx={{
                        color: '#757575',
                        fontFamily: 'monospace',
                        fontSize: '0.75rem',
                        display: 'block',
                        textAlign: 'center',
                        mt: 1.5,
                        textTransform: 'uppercase',
                        letterSpacing: '0.5px'
                    }}
                >
                    {/*AUTO-REFRESH*/}
                </Typography>
            </Box>
        </Backdrop>
    );
}

export default VersionUpdateOverlay;