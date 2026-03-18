
import CloudOffIcon from '@mui/icons-material/CloudOff';
import SyncProblemIcon from '@mui/icons-material/SyncProblem';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import { keyframes } from '@emotion/react';
import { Backdrop, Box, LinearProgress, Typography } from "@mui/material";
import { useSelector } from "react-redux";
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

function ConnectionOverlay() {
    const { t } = useTranslation('dashboard');
    const {
        connecting,
        connected,
        disconnected,
        reConnectAttempt,
        connectionError,
        initialDataLoading,
        initialDataProgress,
    } = useSelector((state) => state.dashboard);

    // Don't show overlay if connected
    if (connected && !connecting && !initialDataLoading) {
        return null;
    }

    // Determine the status and styling with industrial colors
    const getConnectionStatus = () => {
        if (connectionError) {
            return {
                icon: <ErrorOutlineIcon sx={{ fontSize: 24, color: '#d32f2f' }} />,
                title: t('connection.connection_failed'),
                message: t('connection.network_error'),
                color: '#d32f2f',
                bgColor: '#2a2a2a',
                borderColor: '#d32f2f'
            };
        }

        if (initialDataLoading) {
            return {
                icon: <SyncProblemIcon sx={{ fontSize: 24, color: '#4caf50' }} />,
                title: t('connection.syncing_data', 'Syncing data'),
                message: t('connection.loading_initial_state', 'Loading initial application data'),
                color: '#4caf50',
                bgColor: '#2a2a2a',
                borderColor: '#4caf50'
            };
        }

        if (reConnectAttempt > 0) {
            return {
                icon: <SyncProblemIcon sx={{ fontSize: 24, color: '#ff9800' }} />,
                title: t('connection.reconnecting'),
                message: t('connection.attempt', { count: reConnectAttempt }),
                color: '#ff9800',
                bgColor: '#2a2a2a',
                borderColor: '#ff9800'
            };
        }

        if (connecting || disconnected) {
            return {
                icon: <CloudOffIcon sx={{ fontSize: 24, color: '#757575' }} />,
                title: t('connection.connecting'),
                message: t('connection.establishing_connection'),
                color: '#757575',
                bgColor: '#2a2a2a',
                borderColor: '#757575'
            };
        }

        return null;
    };

    const status = getConnectionStatus();

    if (!status) {
        return null;
    }

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
                    backgroundColor: status.bgColor,
                    border: `1px solid ${status.borderColor}`,
                    borderRadius: 1,
                    padding: 3,
                    minWidth: 280,
                    maxWidth: 320,
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
                    {status.icon}
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
                            {status.title}
                        </Typography>
                        <Typography
                            variant="body2"
                            sx={{
                                color: '#b0b0b0',
                                fontSize: '0.875rem'
                            }}
                        >
                            {status.message}
                        </Typography>
                    </Box>
                </Box>

                {/* Progress indicator */}
                {initialDataLoading && initialDataProgress.total > 0 ? (
                    <>
                        <LinearProgress
                            variant="determinate"
                            value={(initialDataProgress.completed / initialDataProgress.total) * 100}
                            sx={{
                                height: 4,
                                borderRadius: 1,
                                backgroundColor: '#424242',
                                '& .MuiLinearProgress-bar': {
                                    backgroundColor: status.color,
                                },
                            }}
                        />
                        <Typography
                            variant="caption"
                            sx={{
                                color: '#b0b0b0',
                                fontSize: '0.75rem',
                                display: 'block',
                                textAlign: 'center',
                                mt: 1,
                            }}
                        >
                            {t('connection.loading_progress', 'Loaded {{completed}} of {{total}}', {
                                completed: initialDataProgress.completed,
                                total: initialDataProgress.total,
                            })}
                        </Typography>
                    </>
                ) : (
                    <Box
                        sx={{
                            width: '100%',
                            height: 2,
                            backgroundColor: '#424242',
                            borderRadius: 1,
                            overflow: 'hidden',
                            position: 'relative'
                        }}
                    >
                        <Box
                            sx={{
                                height: '100%',
                                width: '30%',
                                backgroundColor: status.color,
                                borderRadius: 1,
                                animation: `${keyframes`
                                    0% { transform: translateX(-100%); }
                                    100% { transform: translateX(333%); }
                                `} 2s infinite ease-in-out`,
                            }}
                        />
                    </Box>
                )}

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
                    {/*{connectionError ? 'ERROR' :*/}
                    {/*    reConnectAttempt > 0 ? 'RECONNECTING' : 'CONNECTING'}*/}
                </Typography>
            </Box>
        </Backdrop>
    );
}

export default ConnectionOverlay;
