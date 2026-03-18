/**
 * VFO Control Components
 *
 * Activate/Mute buttons and Frequency display for VFO
 */

import React from 'react';
import { Box, ToggleButton, Tooltip } from '@mui/material';
import { useTranslation } from 'react-i18next';
import LCDFrequencyDisplay from '../../common/lcd-frequency-display.jsx';

/**
 * VFO Activate Button Component
 */
export const VfoActivateButton = ({ vfoIndex, vfoActive, onVFOActiveChange }) => {
    const { t } = useTranslation('waterfall');

    return (
        <Tooltip title={vfoActive ? "Deactivate VFO" : "Activate VFO"} arrow>
            <ToggleButton
                value="active"
                selected={vfoActive}
                onChange={() => onVFOActiveChange(vfoIndex, !vfoActive)}
                sx={{
                    flex: 1,
                    height: '32px',
                    fontSize: '0.8rem',
                    border: '1px solid',
                    borderColor: 'rgba(255, 255, 255, 0.23)',
                    borderRadius: '4px',
                    color: 'text.secondary',
                    textTransform: 'none',
                    backgroundColor: 'rgba(255, 255, 255, 0.05)',
                    transition: 'all 0.2s ease-in-out',
                    '&.Mui-selected': {
                        backgroundColor: 'success.main',
                        color: 'success.contrastText',
                        borderColor: 'success.main',
                        fontWeight: 600,
                        boxShadow: '0 0 8px rgba(76, 175, 80, 0.4)',
                        '&:hover': {
                            backgroundColor: 'success.dark',
                            boxShadow: '0 0 12px rgba(76, 175, 80, 0.6)',
                        }
                    },
                    '&:hover': {
                        backgroundColor: 'rgba(255, 255, 255, 0.1)',
                        borderColor: 'rgba(255, 255, 255, 0.4)',
                    }
                }}
            >
                {vfoActive ? t('vfo.active') : t('vfo.activate', 'Activate')}
            </ToggleButton>
        </Tooltip>
    );
};

/**
 * VFO Mute Button Component
 */
export const VfoMuteButton = ({ vfoIndex, vfoActive, vfoMuted, onMuteToggle }) => {
    const { t } = useTranslation('waterfall');

    return (
        <Tooltip title={vfoMuted ? "Unmute VFO audio" : "Mute VFO audio"} arrow>
            <span>
                <ToggleButton
                    value="listen"
                    selected={!vfoMuted}
                    disabled={!vfoActive}
                    onChange={() => onMuteToggle(vfoIndex)}
                    sx={{
                        flex: 1,
                        height: '32px',
                        fontSize: '0.8rem',
                        border: '1px solid',
                        borderColor: vfoMuted ? 'rgba(255, 152, 0, 0.5)' : 'rgba(255, 255, 255, 0.23)',
                        borderRadius: '4px',
                        color: 'text.secondary',
                        textTransform: 'none',
                        backgroundColor: vfoMuted ? 'rgba(255, 152, 0, 0.1)' : 'rgba(255, 255, 255, 0.05)',
                        transition: 'all 0.2s ease-in-out',
                        '&.Mui-selected': {
                            backgroundColor: 'primary.main',
                            color: 'primary.contrastText',
                            borderColor: 'primary.main',
                            fontWeight: 600,
                            boxShadow: '0 0 8px rgba(33, 150, 243, 0.4)',
                            '&:hover': {
                                backgroundColor: 'primary.dark',
                                boxShadow: '0 0 12px rgba(33, 150, 243, 0.6)',
                            }
                        },
                        '&:hover': {
                            backgroundColor: vfoMuted ? 'rgba(255, 152, 0, 0.2)' : 'rgba(255, 255, 255, 0.1)',
                            borderColor: vfoMuted ? 'rgba(255, 152, 0, 0.7)' : 'rgba(255, 255, 255, 0.4)',
                        },
                        '&.Mui-disabled': {
                            backgroundColor: 'rgba(255, 255, 255, 0.02)',
                            borderColor: 'rgba(255, 255, 255, 0.08)',
                            color: 'rgba(255, 255, 255, 0.3)',
                            opacity: 0.5,
                        }
                    }}
                >
                    {!vfoMuted ? t('vfo.mute', 'Mute') : t('vfo.muted', 'Muted')}
                </ToggleButton>
            </span>
        </Tooltip>
    );
};

/**
 * VFO Frequency Display Component
 */
export const VfoFrequencyDisplay = ({ frequency }) => {
    return (
        <Box sx={{
            mt: 2,
            mb: 0,
            width: '100%',
            typography: 'body1',
            fontWeight: 'medium',
            alignItems: 'center'
        }}>
            <Box
                sx={{
                    width: '100%',
                    fontFamily: "Monospace",
                    color: '#2196f3',
                    alignItems: 'center',
                    textAlign: 'center',
                    justifyContent: 'center'
                }}>
                <LCDFrequencyDisplay
                    frequency={frequency}
                    size={"large"} />
            </Box>
        </Box>
    );
};
