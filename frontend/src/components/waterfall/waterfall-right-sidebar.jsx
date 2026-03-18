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

import React from 'react';
import { Box, Button, Stack, Slider, Typography, useTheme } from '@mui/material';
import { useDispatch, useSelector } from 'react-redux';
import { AutoScaleOnceIcon, AutoDBIcon } from '../common/custom-icons.jsx';
import { setAutoDBRange, setDbRange } from './waterfall-slice.jsx';

const WaterfallRightSidebar = ({ workerRef, dimensions, isFullscreen = false }) => {
    const theme = useTheme();
    const dispatch = useDispatch();

    const {
        dbRange,
        isStreaming,
        autoDBRange,
        showRightSideWaterFallAccessories,
        packetsDrawerOpen,
        packetsDrawerHeight,
    } = useSelector((state) => state.waterfall);

    if (!showRightSideWaterFallAccessories) {
        return null;
    }

    // Calculate height based on actual bottom container height
    // The bottom container consists of: status bar (30px) + drawer handle (32px) + drawer content (if open)
    const statusBarHeight = 30;
    const drawerHandleHeight = 32;
    const drawerContentHeight = packetsDrawerOpen ? packetsDrawerHeight : 0;
    const bottomContainerHeight = statusBarHeight + drawerHandleHeight + drawerContentHeight;
    const additionalOffset = 72;

    // Total offset is bottom container height + additional offset
    // ResizeObserver dimensions already account for fullscreen vs normal mode
    const totalOffset = bottomContainerHeight + additionalOffset;

    return (
        <Box
            className={'right-vertical-bar'}
            sx={{
                width: '50px',
                minWidth: '50px',
                maxWidth: '50px',
                height: `calc(${dimensions['height']}px - ${totalOffset}px)`,
                position: 'relative',
                borderLeft: `1px solid ${theme.palette.border.main}`,
                backgroundColor: theme.palette.background.paper,
                display: 'flex',
                flexDirection: 'column',
                flexShrink: 0,
            }}
        >
            <Stack spacing={0}>
                <Button
                    startIcon={<AutoScaleOnceIcon/>}
                    variant="filled"
                    disabled={!isStreaming}
                    color={autoDBRange? "success": "info"}
                    onClick={() => {
                        workerRef.current.postMessage({ cmd: 'autoScaleDbRange' });
                    }}
                    title="Auto range dB scale once"
                    sx={{
                        borderRadius: 0,
                    }}
                >
                </Button>
                <Button
                    startIcon={<AutoDBIcon/>}
                    variant={autoDBRange ? "contained" : "filled"}
                    disabled={!isStreaming}
                    color={autoDBRange ? "success" : "info"}
                    onClick={() => dispatch(setAutoDBRange(!autoDBRange))}
                    title="Toggle automatic dB scale"
                    sx={{
                        borderRadius: 0,
                    }}
                >
                </Button>
            </Stack>
            <Box sx={{
                borderTop: `1px solid ${theme.palette.border.main}`,
                p: 0,
                m: 0
            }}>
                <Typography
                    variant="body2"
                    sx={{
                        mt: 0.5,
                        width: '100%',
                        textAlign: 'center',
                        fontFamily: 'Monospace'
                }}>
                    {dbRange[1]}
                </Typography>
            </Box>
            <Slider
                disabled={!isStreaming}
                orientation="vertical"
                value={dbRange}
                onChange={(e, newValue) => {
                    dispatch(setDbRange(newValue));
                }}
                min={-120}
                max={30}
                step={1}
                valueLabelDisplay="auto"
                sx={{
                    width: '22px',
                    margin: '0 auto',
                    '& .MuiSlider-thumb': {
                        width: 25,
                        height: 25,
                    },
                    '& .MuiSlider-track': {
                        width: 10
                    },
                    '& .MuiSlider-rail': {
                        width: 10
                    },
                    '& .MuiSlider-valueLabel': {
                        fontSize: '0.75rem',
                        fontWeight: 'bold',
                        fontFamily: 'Monospace',
                        backgroundColor: 'rgba(0, 0, 0, 0.8)',
                    }
                }}
            />

            <Box sx={{
                p: 0,
                m: 0
            }}>
                <Typography
                    variant="body2"
                    sx={{
                        width: '100%',
                        textAlign: 'center',
                        fontFamily: 'Monospace'
                }}>
                    {dbRange[0]}
                </Typography>
            </Box>
        </Box>
    );
};

export default WaterfallRightSidebar;
