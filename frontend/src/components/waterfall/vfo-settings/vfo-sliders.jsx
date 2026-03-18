/**
 * VFO Sliders Components
 *
 * Squelch and Volume slider controls for VFO
 */

import React from 'react';
import { Box, IconButton, Slider, Stack, Tooltip } from '@mui/material';
import VolumeDown from '@mui/icons-material/VolumeDown';
import VolumeOffIcon from '@mui/icons-material/VolumeOff';
import { SquelchIconCentered } from '../../common/dataurl-icons.jsx';

/**
 * Squelch Slider Component
 */
export const SquelchSlider = ({ vfoIndex, vfoActive, squelch, rfPower, onVFOPropertyChange }) => {
    const handleAutoSquelch = () => {
        if (rfPower !== null) {
            // Set squelch to current noise floor + 5 dB
            const autoSquelch = Math.round(rfPower + 5);
            onVFOPropertyChange(vfoIndex, { squelch: Math.max(-150, Math.min(0, autoSquelch)) });
        }
    };

    return (
        <Stack
            spacing={0}
            direction="row"
            alignItems="center"
            sx={{ mt: 2 }}
            data-slider="squelch"
            data-vfo-index={vfoIndex}
        >
            <Tooltip title="Auto Squelch (Noise Floor + 5dB)" arrow>
                <span>
                    <IconButton
                        onClick={handleAutoSquelch}
                        disabled={!vfoActive || rfPower === null}
                        sx={{
                            color: 'text.secondary',
                            backgroundColor: 'rgba(33, 150, 243, 0.08)',
                            '&:hover': {
                                backgroundColor: 'rgba(33, 150, 243, 0.15)',
                            },
                            '&:disabled': {
                                backgroundColor: 'transparent',
                            },
                        }}
                    >
                        <SquelchIconCentered size={24} />
                    </IconButton>
                </span>
            </Tooltip>
            <Slider
                value={squelch}
                min={-150}
                max={0}
                onChange={(e, val) => onVFOPropertyChange(vfoIndex, { squelch: val })}
                disabled={!vfoActive}
                sx={{ ml: '5px' }}
            />
            <Box sx={{ minWidth: 50, fontSize: '0.875rem', textAlign: 'right' }}>
                {squelch} dB
            </Box>
        </Stack>
    );
};

/**
 * Volume Slider Component
 */
export const VolumeSlider = ({ vfoIndex, vfoActive, volume, muted, onVFOPropertyChange, onMuteToggle }) => {
    return (
        <Stack
            spacing={0}
            direction="row"
            alignItems="center"
            sx={{ mt: 2 }}
            data-slider="volume"
            data-vfo-index={vfoIndex}
        >
            <Tooltip title={muted ? "Unmute VFO" : "Mute VFO"} arrow>
                <span>
                    <IconButton
                        onClick={() => onMuteToggle(vfoIndex)}
                        disabled={!vfoActive}
                        sx={{
                            color: muted ? 'error.main' : 'text.secondary',
                            backgroundColor: muted ? 'rgba(244, 67, 54, 0.08)' : 'rgba(33, 150, 243, 0.08)',
                            '&:hover': {
                                backgroundColor: muted ? 'rgba(244, 67, 54, 0.15)' : 'rgba(33, 150, 243, 0.15)',
                            },
                            '&:disabled': {
                                backgroundColor: 'transparent',
                            },
                        }}
                    >
                        {muted ? <VolumeOffIcon /> : <VolumeDown />}
                    </IconButton>
                </span>
            </Tooltip>
            <Slider
                value={volume}
                onChange={(e, val) => onVFOPropertyChange(vfoIndex, { volume: val })}
                disabled={!vfoActive}
                sx={{ ml: '5px' }}
            />
            <Box sx={{ minWidth: 50, fontSize: '0.875rem', textAlign: 'right' }}>
                {volume}%
            </Box>
        </Stack>
    );
};
