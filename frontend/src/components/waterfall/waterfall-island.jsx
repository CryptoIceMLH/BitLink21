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


import React, {useEffect, useRef, useState, useCallback} from 'react';
import {
    Box,
    Typography,
    Button,
    Stack,
    Slider,
    useTheme,
    Fade,
} from '@mui/material';
import CameraAltIcon from '@mui/icons-material/CameraAlt';
import {useDispatch, useSelector} from "react-redux";
import { AutoScaleOnceIcon, AutoDBIcon } from '../common/custom-icons.jsx';
import {
    getClassNamesBasedOnGridEditing,
    humanizeFrequency,
    humanizeNumber,
    TitleBar,
    WaterfallStatusBarPaper
} from "../common/common.jsx";
import WaterfallAndBandscope from './waterfall-bandscope.jsx'
import {
    setColorMap,
    setColorMaps,
    setDbRange,
    setFFTSize,
    setFFTSizeOptions,
    setGain,
    setSampleRate,
    setCenterFrequency,
    setErrorMessage,
    setErrorDialogOpen,
    setIsStreaming,
    setStartStreamingLoading,
    setAutoDBRange,
    setShowRightSideWaterFallAccessories,
    setShowLeftSideWaterFallAccessories,
    setFFTWindow,
    setSelectedSDRId,
    setSelectedOffsetValue,
    setFFTAveraging,
    setShowRotatorDottedLines,
    setAutoScalePreset,
    saveWaterfallSnapshot,
    setFFTdataOverflow,
} from './waterfall-slice.jsx';
import {
    enableVFO1,
    enableVFO2,
    enableVFO3,
    enableVFO4,
    disableVFO1,
    disableVFO2,
    disableVFO3,
    disableVFO4,
    setVFOProperty,
    setVfoInactive,
    setVfoActive,
} from './vfo-marker/vfo-slice.jsx';
import { toast } from "../../utils/toast-with-timestamp.jsx";
import { useSocket } from "../common/socket.jsx";
import {frequencyBands} from "./bandplans.jsx";
import WaterfallStatusBar from "./waterfall-statusbar.jsx";
import WaterfallToolbar from "./waterfall-toolbar.jsx";
import WaterfallErrorDialog from "./waterfall-error-dialog.jsx";
import useWaterfallStream from "./waterfall-stream.jsx";
import { useTranslation } from 'react-i18next';
import { useWaterfallSnapshot } from "./waterfall-snapshot.js";
import DecodedPacketsDrawer from "./decoded-packets-drawer.jsx";
import WaterfallRightSidebar from "./waterfall-right-sidebar.jsx";
import { useAudio } from "../dashboard/audio-provider.jsx";
import {
    generateSnapshotName,
    toggleFullscreen as toggleFullscreenUtil,
    setupFullscreenListeners,
    initializeWorkerWithCanvases,
    setupCanvasCaptureListener,
    paintLeftMarginFiller
} from './waterfall-utils.jsx';
import { useWaterfallEventHandlers, useSnapshotHandlers } from './waterfall-events.jsx';
import { getRotatorEventDisplay } from '../target/rotator-constants.js';

// Make a new worker
export const createExternalWorker = () => {

    try {
        console.info("Creating external worker for waterfall")
        return new Worker(
            new URL('./waterfall-worker.js', import.meta.url),
            { type: 'module' }
        );
    }
    catch (error) {
        toast.error(`Failed to create waterfall worker: ${error.message}`);
    }
};


const MainWaterfallDisplay = React.memo(function MainWaterfallDisplay({
    playbackElapsedSecondsRef,
    playbackRemainingSecondsRef,
    playbackTotalSecondsRef
}) {
    const { t } = useTranslation('waterfall');
    const theme = useTheme();
    const dispatch = useDispatch();
    const { socket } = useSocket();
    const waterFallCanvasRef = useRef(null);
    const bandscopeCanvasRef = useRef(null);
    const dBAxisScopeCanvasRef = useRef(null);
    const waterFallLeftMarginCanvasRef = useRef(null);
    const waterFallLeftMarginFillerRef = useRef(null);
    const workerRef = useRef(null);
    const dottedLineImageDataRef = useRef(null);
    const canvasTransferredRef = useRef(false);
    const visualSettingsRef = useRef({
        dbRange: [-120, 30],
        colorMap: 'magma',
        fftSize: 1024,
        sampleRate: 2000000,
        centerFrequency: 1000000000,
    });
    const colorCache = useRef(new Map());

    // Add state for tracking metrics
    const eventMetrics = useRef({
        fftUpdatesPerSecond: 0,
        binsPerSecond: 0,
        totalUpdates: 0,
        timeElapsed: 0,
        renderWaterfallPerSecond: 0,
    });

    // Add refs for tracking event count and bin count
    const eventCountRef = useRef(0);
    const binCountRef = useRef(0);
    const lastMetricUpdateRef = useRef(Date.now());
    const lastTimestampRef = useRef(null);
    const mainWaterFallContainer = useRef(null);
    const [showSnapshotOverlay, setShowSnapshotOverlay] = useState(false);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const {
        colorMap,
        colorMaps,
        dbRange,
        fftSizeOptions,
        fftSize,
        gain,
        sampleRate,
        centerFrequency,
        errorMessage,
        errorDialogOpen,
        isStreaming,
        isConnected,
        targetFPS,
        isPlaying,
        autoDBRange,
        gridEditable,
        fftWindow,
        fftAveraging,
        dBRange,
        waterFallVisualWidth,
        waterFallCanvasWidth,
        waterFallCanvasHeight,
        bandScopeHeight,
        bandscopeTopPadding = 0,
        frequencyScaleHeight,
        selectedSDRId,
        startStreamingLoading,
        gettingSDRParameters,
        showRightSideWaterFallAccessories,
        showLeftSideWaterFallAccessories,
        selectedAntenna,
        selectedOffsetValue,
        fftDataOverflow,
        fftDataOverflowLimit,
        showRotatorDottedLines,
        autoScalePreset,
        waterFallScaleX,
        waterFallPositionX,
        sdrSettingsById,
    } = useSelector((state) => state.waterfall);

    const tunerAgc = sdrSettingsById?.[selectedSDRId]?.draft?.tunerAgc ?? false;
    const rtlAgc = sdrSettingsById?.[selectedSDRId]?.draft?.rtlAgc ?? false;
    const soapyAgc = sdrSettingsById?.[selectedSDRId]?.draft?.soapyAgc ?? false;

    const {
        vfoMarkers,
        maxVFOMarkers,
        vfoColors,
        vfoActive,
    } = useSelector((state) => state.vfo);

    // Get target satellite name from Redux
    const targetSatelliteName = useSelector((state) => state.targetSatTrack?.satelliteData?.details?.name || '');

    // Initialize waterfall snapshot hook
    const { captureSnapshot } = useWaterfallSnapshot({
        bandscopeCanvasRef,
        dBAxisScopeCanvasRef,
        waterFallLeftMarginCanvasRef,
        bandScopeHeight,
        frequencyScaleHeight,
        waterFallCanvasHeight,
        waterFallCanvasWidth,
        waterFallVisualWidth,
        waterFallScaleX,
        waterFallPositionX,
    });

    // Expose captureSnapshot globally for recording
    useEffect(() => {
        window.captureWaterfallSnapshot = captureSnapshot;
        return () => {
            delete window.captureWaterfallSnapshot;
        };
    }, [captureSnapshot]);
    const centerFrequencyRef = useRef(centerFrequency);
    const sampleRateRef = useRef(sampleRate);

    const {
        lastRotatorEvent
    } = useSelector((state) => state.targetSatTrack);

    const targetFPSRef = useRef(targetFPS);
    const waterfallControlRef = useRef(null);
    const lastRotatorEventRef = useRef("");
    const [scrollFactor, setScrollFactor] = useState(1);
    const accumulatedRowsRef = useRef(0);
    const [bandscopeAxisYWidth, setBandscopeAxisYWidth] = useState(60);
    const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

    // Rolling window rate limiting
    const overflowRef = useRef(false);
    const lastAllowedUpdateRef = useRef(0);
    const allowedIntervalRef = useRef(1000 / fftDataOverflowLimit);

    // Rolling window for rate tracking and track last 1 second of timestamps
    const timestampWindowRef = useRef([]);
    const windowSizeMs = 1000;

    // Note: Playback timing refs (playbackElapsedSecondsRef, playbackRemainingSecondsRef,
    // playbackTotalSecondsRef) are now passed as props from parent component

    // Use event handlers hook
    const {
        handleZoomIn,
        handleZoomOut,
        handleZoomReset,
        toggleRotatorDottedLines,
        handleSetAutoScalePreset
    } = useWaterfallEventHandlers({
        waterfallControlRef,
        workerRef,
        dispatch,
        setShowRotatorDottedLines,
        setAutoScalePreset
    });

    // Use snapshot handlers hook
    const snapshotNameGenerator = useCallback(() => {
        return generateSnapshotName(targetSatelliteName, centerFrequency);
    }, [targetSatelliteName, centerFrequency]);

    const {
        captureSnapshotWithOverlay,
        takeSnapshot
    } = useSnapshotHandlers({
        captureSnapshot,
        generateSnapshotName: snapshotNameGenerator,
        socket,
        dispatch,
        saveWaterfallSnapshot
    });

    // Wrap takeSnapshot to pass setShowSnapshotOverlay
    const handleTakeSnapshot = useCallback(async () => {
        await takeSnapshot(setShowSnapshotOverlay);
    }, [takeSnapshot]);

    // Wrap captureSnapshotWithOverlay to pass setShowSnapshotOverlay
    const handleCaptureSnapshotWithOverlay = useCallback(async (targetWidth = 1620) => {
        return await captureSnapshotWithOverlay(setShowSnapshotOverlay, targetWidth);
    }, [captureSnapshotWithOverlay]);

    // Expose the capture function with overlay globally for use by other components
    useEffect(() => {
        window.captureWaterfallSnapshotWithOverlay = handleCaptureSnapshotWithOverlay;
        return () => {
            delete window.captureWaterfallSnapshotWithOverlay;
        };
    }, [handleCaptureSnapshotWithOverlay]);

    // Expose waterfall zoom and pan transform values globally for real-time access
    useEffect(() => {
        window.getWaterfallTransform = () => {
            const scale = waterfallControlRef.current?.getCurrentScale() || 1;
            const positionX = waterfallControlRef.current?.getCurrentPosition() || 0;
            const containerWidth = waterfallControlRef.current?.getContainerWidth() || waterFallVisualWidth;
            const canvasWidth = waterFallCanvasWidth;

            // Calculate Hz per container pixel at current zoom
            const hzPerContainerPixel = sampleRate / (containerWidth * scale);

            // Calculate visible frequency range
            const startFreqOffset = -positionX * hzPerContainerPixel;
            const endFreqOffset = startFreqOffset + (containerWidth * hzPerContainerPixel);

            const startFreq = centerFrequency - (sampleRate / 2) + startFreqOffset;
            const endFreq = centerFrequency - (sampleRate / 2) + endFreqOffset;
            const visibleBandwidth = endFreq - startFreq;

            return {
                scale,
                positionX,
                containerWidth,
                canvasWidth,
                startFreq,
                endFreq,
                visibleBandwidth,
                centerFrequency,
                sampleRate
            };
        };
        return () => {
            delete window.getWaterfallTransform;
        };
    }, [centerFrequency, sampleRate, waterFallVisualWidth, waterFallCanvasWidth]);

    const toggleFullscreen = useCallback(() => {
        toggleFullscreenUtil(mainWaterFallContainer.current, setIsFullscreen);
    }, []);

    useEffect(() => {
        if (workerRef.current && lastRotatorEvent) {
            // Format event with decorative dashes for waterfall display
            const formattedEvent = getRotatorEventDisplay(lastRotatorEvent);

            workerRef.current.postMessage({
                cmd: 'rotatorEvent',
                event: formattedEvent,
            });
        }
    }, [lastRotatorEvent]);

    useEffect(() => {
        if (waterFallCanvasRef.current && !canvasTransferredRef.current) {
            // Worker message handler
            const handleWorkerMessage = (event) => {
                const { type, data } = event.data;

                if (type === 'metrics') {
                    eventMetrics.current = data;
                } else if (type === 'status') {
                    // Optional: handle status updates from the worker
                } else if (type === 'autoScaleResult') {
                    const { dbRange, stats } = data;
                    console.log('New dB range:', dbRange);
                    console.log('Analysis stats:', stats);
                    dispatch(setDbRange(dbRange));
                } else if (type === 'waterfallCaptured') {
                    // Convert blob to data URL in main thread
                    const blob = data.blob;
                    const reader = new FileReader();
                    reader.onloadend = function() {
                        window.waterfallCanvasDataURL = reader.result;
                    };
                    reader.onerror = function(error) {
                        console.error('FileReader error:', error);
                        window.waterfallCanvasDataURL = null;
                    };
                    reader.readAsDataURL(blob);
                } else if (type === 'waterfallCaptureFailed') {
                    console.error('Waterfall capture failed:', data?.error);
                    window.waterfallCanvasDataURL = null;
                }
            };

            // Initialize worker with canvases
            initializeWorkerWithCanvases({
                waterFallCanvasRef,
                bandscopeCanvasRef,
                dBAxisScopeCanvasRef,
                waterFallLeftMarginCanvasRef,
                waterFallCanvasWidth,
                waterFallCanvasHeight,
                bandscopeTopPadding,
                colorMap,
                dbRange,
                fftSize,
                showRotatorDottedLines,
                theme,
                workerRef,
                canvasTransferredRef,
                createWorker: createExternalWorker,
                onMessage: handleWorkerMessage
            });

            if (workerRef.current) {
                workerRef.current.postMessage({
                    cmd: 'setAutoScalePreset',
                    preset: autoScalePreset,
                });
            }
        }

        return () => {
            // Cleanup handled elsewhere to avoid StrictMode issues
        };
    }, [waterFallCanvasWidth, waterFallCanvasHeight, colorMap, dbRange, fftSize, showRotatorDottedLines, theme, dispatch, autoScalePreset]);

    // Add event listener for fullscreen change
    useEffect(() => {
        return setupFullscreenListeners(setIsFullscreen);
    }, []);

    // Add event listener for waterfall canvas capture
    useEffect(() => {
        return setupCanvasCaptureListener(workerRef);
    }, []);

    // Paint the waterfall left margin filler canvas with background color
    useEffect(() => {
        paintLeftMarginFiller(waterFallLeftMarginFillerRef.current, theme.palette.background.paper);
    }, [theme.palette.background.paper, bandscopeAxisYWidth]);

    // Update refs when Redux state changes
    useEffect(() => {
        centerFrequencyRef.current = centerFrequency;
    }, [centerFrequency]);

    useEffect(() => {
        sampleRateRef.current = sampleRate;
    }, [sampleRate]);

    // ResizeObserver for the main waterfall container
    useEffect(() => {
        if (!mainWaterFallContainer.current) {
            return;
        }
        const resizeObserver = new ResizeObserver(entries => {
            const {contentRect} = entries[0];
            // In fullscreen, use window dimensions; otherwise use observed dimensions
            if (document.fullscreenElement === mainWaterFallContainer.current) {
                setDimensions({width: window.innerWidth, height: window.innerHeight});
            } else {
                setDimensions({width: contentRect.width, height: contentRect.height});
            }
        });

        // Observe parent element for normal mode sizing
        const targetElement = mainWaterFallContainer.current.parentElement;
        if (targetElement) {
            resizeObserver.observe(targetElement);
        }

        // Also listen for fullscreen changes
        const handleFullscreenChange = () => {
            if (document.fullscreenElement === mainWaterFallContainer.current) {
                setDimensions({width: window.innerWidth, height: window.innerHeight});
            } else if (mainWaterFallContainer.current?.parentElement) {
                const rect = mainWaterFallContainer.current.parentElement.getBoundingClientRect();
                setDimensions({width: rect.width, height: rect.height});
            }
        };

        document.addEventListener('fullscreenchange', handleFullscreenChange);

        return () => {
            resizeObserver.disconnect();
            document.removeEventListener('fullscreenchange', handleFullscreenChange);
        };
    }, []);

    // Update the ref whenever the Redux state changes
    useEffect(() => {
        targetFPSRef.current = targetFPS;
    }, [targetFPS]);

    // Effect to sync state to the ref
    useEffect(() => {
        visualSettingsRef.current.dbRange = dbRange;
        visualSettingsRef.current.colorMap = colorMap;
        visualSettingsRef.current.sampleRate = sampleRate;
        visualSettingsRef.current.centerFrequency = centerFrequency;

    }, [dbRange, colorMap, centerFrequency, sampleRate]);

    // Get audio context for proactive resume on stream start
    const { getAudioState, initializeAudio } = useAudio();

    const { startStreaming, stopStreaming, playButtonEnabledOrNot } = useWaterfallStream({
        workerRef,
        targetFPSRef,
        playbackElapsedSecondsRef,
        playbackRemainingSecondsRef,
        playbackTotalSecondsRef,
        getAudioState,
        initializeAudio
    });

    useEffect(() => {
        if (!workerRef.current) return;

        workerRef.current.postMessage({
            cmd: 'updateConfig',
            colorMap,
            dbRange,
            fftSize,
            theme: {
                palette: {
                    background: {
                        default: theme.palette.background.default,
                        paper: theme.palette.background.paper,
                        elevated: theme.palette.background.elevated,
                    },
                    border: {
                        main: theme.palette.border.main,
                        light: theme.palette.border.light,
                        dark: theme.palette.border.dark,
                    },
                    overlay: {
                        light: theme.palette.overlay.light,
                        medium: theme.palette.overlay.medium,
                        dark: theme.palette.overlay.dark,
                    },
                    text: {
                        primary: theme.palette.text.primary,
                        secondary: theme.palette.text.secondary,
                    }
                }
            }
        });
    }, [colorMap, dbRange, fftSize, theme.palette.background, theme.palette.border, theme.palette.overlay, theme.palette.text]);

    useEffect(() => {
        if (!workerRef.current) return;
        workerRef.current.postMessage({
            cmd: 'setAutoScalePreset',
            preset: autoScalePreset,
        });
    }, [autoScalePreset]);

    // Update the worker when FPS changes
    useEffect(() => {
        targetFPSRef.current = targetFPS;

        if (workerRef.current && isStreaming) {
            workerRef.current.postMessage({
                cmd: 'updateFPS',
                data: {fps: targetFPS}
            });
        }
    }, [targetFPS]);

    // Call this periodically, for example:
    useEffect(() => {
        let interval;

        if (isStreaming && autoDBRange) {
            interval = setInterval(() => {
                workerRef.current.postMessage({ cmd: 'autoScaleDbRange' });
            }, 2000); // Update 2 seconds
        }

        return () => {
            if (interval) {
                clearInterval(interval);
            }
        };
    }, [isStreaming, autoDBRange]);

    const toggleLeftSide = () => dispatch(setShowLeftSideWaterFallAccessories(!showLeftSideWaterFallAccessories));
    const toggleRightSide = () => dispatch(setShowRightSideWaterFallAccessories(!showRightSideWaterFallAccessories));
    const toggleAutoRange = () => dispatch(setAutoDBRange(!autoDBRange));
    const autoScale = () => {
        if (workerRef.current) {
            workerRef.current.postMessage({ cmd: 'autoScaleDbRange' });
        }
    };
    const handleToggleVfo = (index) => {
        if (vfoActive[index]) {
            dispatch(setVfoInactive(index));
        } else {
            dispatch(setVfoActive(index));
        }
    };

    return (
        <div ref={mainWaterFallContainer}>
        <TitleBar
            className={getClassNamesBasedOnGridEditing(gridEditable, ["window-title-bar"])}
        >
            <Box sx={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%'}}>
                <Box sx={{display: 'flex', alignItems: 'center'}}>
                    <Typography variant="subtitle2" sx={{fontWeight: 'bold'}}>
                        {t('main_title')}
                    </Typography>
                </Box>
            </Box>
        </TitleBar>
            <Box
                sx={{
                    display: 'flex',
                    gap: 1,
                    justifyContent: 'left',
                    flexWrap: 'wrap',
                }}
            >
                <WaterfallToolbar
                    startStreamingLoading={startStreamingLoading}
                    playButtonDisabled={playButtonEnabledOrNot()}
                    startStreaming={startStreaming}
                    stopStreaming={stopStreaming}
                    isStreaming={isStreaming}
                    showLeftSideWaterFallAccessories={showLeftSideWaterFallAccessories}
                    toggleLeftSideWaterFallAccessories={toggleLeftSide}
                    showRightSideWaterFallAccessories={showRightSideWaterFallAccessories}
                    toggleRightSideWaterFallAccessories={toggleRightSide}
                    autoDBRange={autoDBRange}
                    toggleAutoDBRange={toggleAutoRange}
                    autoScale={autoScale}
                    toggleFullscreen={toggleFullscreen}
                    isFullscreen={isFullscreen}
                    handleZoomIn={handleZoomIn}
                    handleZoomOut={handleZoomOut}
                    handleZoomReset={handleZoomReset}
                    vfoColors={vfoColors}
                    vfoActive={vfoActive}
                    toggleVfo={handleToggleVfo}
                    takeSnapshot={handleTakeSnapshot}
                    fftDataOverflow={fftDataOverflow}
                    showRotatorDottedLines={showRotatorDottedLines}
                    toggleRotatorDottedLines={toggleRotatorDottedLines}
                    setAutoScalePreset={handleSetAutoScalePreset}
                />
            </Box>

            {/* Container for both bandscope and waterfall */}

            <Box
                sx={{
                    width: '100%',
                    height: '100%',
                    bgcolor: theme.palette.background.default,
                    position: 'relative',
                    borderRadius: 1,

                }}
            >
                <Box sx={{
                    height: '100%',
                    display: 'flex',
                    flexDirection: 'row',
                    position: 'relative',
                }}>
                    {/* Snapshot overlay - covers entire waterfall content area */}
                    <Fade in={showSnapshotOverlay}>
                        <Box
                            sx={{
                                position: 'absolute',
                                top: 0,
                                left: 0,
                                right: 0,
                                bottom: 0,
                                backgroundColor: 'rgba(0, 0, 0, 0.5)',
                                zIndex: 1000,
                                pointerEvents: 'none',
                            }}
                        >
                        </Box>
                    </Fade>

                    {/* Left column - Y-axis canvases */}
                    <Box
                        className={"left-vertical-bar"}
                        sx={{
                            width: bandscopeAxisYWidth,
                            minWidth: bandscopeAxisYWidth,
                            maxWidth: bandscopeAxisYWidth,
                            height: '1000px',
                            position: 'relative',
                            //borderRight: '1px solid rgba(255, 255, 255, 0.2)',
                            display: showLeftSideWaterFallAccessories ? 'inherit' : 'none',
                            flexDirection: 'column',
                            flexShrink: 0,
                        }}
                    >
                        <canvas
                            ref={dBAxisScopeCanvasRef}
                            width={bandscopeAxisYWidth}
                            height={bandScopeHeight + bandscopeTopPadding}
                            style={{
                                width: '100%',
                                height: `${bandScopeHeight + bandscopeTopPadding}px`,
                                backgroundColor: theme.palette.background.elevated,
                                display: 'block',
                                transform: 'translateZ(0)',
                                backfaceVisibility: 'hidden',
                                perspective: '1000px',
                                borderRight: `1px solid ${theme.palette.border.light}`,
                            }}
                        />
                        <canvas
                            ref={waterFallLeftMarginFillerRef}
                            className={"waterfall-left-margin-filler"}
                            width={bandscopeAxisYWidth}
                            height={21}
                            style={{
                                width: '100%',
                                height: '21px',
                                backgroundColor: theme.palette.background.paper,
                                borderTop: `1px solid ${theme.palette.border.main}`,
                                borderRight: `1px solid ${theme.palette.border.light}`,
                                display: 'block',
                                transform: 'translateZ(0)',
                                backfaceVisibility: 'hidden',
                                perspective: '1000px',
                            }}
                        />
                        <canvas
                            className={"waterfall-left-margin-canvas"}
                            ref={waterFallLeftMarginCanvasRef}
                            width={bandscopeAxisYWidth}
                            height={waterFallCanvasHeight}
                            style={{
                                width: '100%',
                                //height: `${dimensions['height'] - 230}px`,
                                height: `${waterFallCanvasHeight}px`,
                                display: 'block',
                                backgroundColor: theme.palette.background.paper,
                                borderRight: `1px solid ${theme.palette.border.light}`,
                                transform: 'translateZ(0)',
                                backfaceVisibility: 'hidden',
                                perspective: '1000px',
                            }}

                        />
                    </Box>

                    {/* Main visualization canvases */}
                    <WaterfallAndBandscope
                        ref={waterfallControlRef}
                        bandscopeCanvasRef={bandscopeCanvasRef}
                        waterFallCanvasRef={waterFallCanvasRef}
                        centerFrequency={centerFrequency}
                        sampleRate={sampleRate}
                        waterFallWindowHeight={dimensions['height']}
                        frequencyBands={frequencyBands}
                        playbackRemainingSecondsRef={playbackRemainingSecondsRef}
                    />

                    <WaterfallRightSidebar
                        workerRef={workerRef}
                        dimensions={dimensions}
                        isFullscreen={isFullscreen}
                    />

                    {/* Decoded packets overlay - DISABLED */}
                    {/* <DecodedPacketsOverlay
                        containerWidth={dimensions.width}
                        showLeftSide={showLeftSideWaterFallAccessories}
                        showRightSide={showRightSideWaterFallAccessories}
                        leftSideWidth={bandscopeAxisYWidth}
                        rightSideWidth={50}
                    /> */}
                </Box>
            </Box>

            <WaterfallErrorDialog
                open={errorMessage !== '' && errorDialogOpen}
                message={errorMessage}
                onClose={() => dispatch(setErrorDialogOpen(false))}
            />

            {/* Bottom container for status bar and drawer */}
            <Box
                sx={{
                    position: 'absolute',
                    bottom: 0,
                    left: 0,
                    right: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    zIndex: 450,
                }}
            >
                <WaterfallStatusBar isStreaming={isStreaming} eventMetrics={eventMetrics} centerFrequency={centerFrequency} sampleRate={sampleRate} gain={gain} />
                <DecodedPacketsDrawer />
            </Box>
        </div>
    );
});

export default MainWaterfallDisplay;
