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


import React, {useCallback, useEffect, useRef, useState, useImperativeHandle, forwardRef} from "react";
import {useDispatch, useSelector} from "react-redux";
import {Box, IconButton, useTheme} from "@mui/material";
import FrequencyScale from "./frequency-scale.jsx";
import BookmarkCanvas from "./bookmarks-overlay.jsx";
import {
    setBookMarks,
    setWaterFallScaleX,
    setWaterFallPositionX
} from "./waterfall-slice.jsx";
import VFOMarkersContainer from './vfo-marker/vfo-container.jsx';
import FrequencyBandOverlay from './bandplan-overlay.jsx';
import {useDopplerNeighbors} from '../../hooks/useDopplerNeighbors.jsx';


const WaterfallAndBandscope = forwardRef(function WaterfallAndBandscope({
                                              bandscopeCanvasRef,
                                              waterFallCanvasRef,
                                              centerFrequency,
                                              sampleRate,
                                              waterFallWindowHeight,
                                              frequencyBands = [],
                                              minZoom = 1,
                                              maxZoom = 20,
                                              playbackRemainingSecondsRef,
                                          }, ref) {

    const theme = useTheme();
    const containerRef = useRef(null);
    const containerWidthRef = useRef(0);
    const [isMobile, setIsMobile] = useState(false);
    const scaleRef = useRef(1);
    const positionXRef = useRef(0);
    const isDraggingRef = useRef(false);
    const lastXRef = useRef(0);
    const lastPinchDistanceRef = useRef(0);
    const pinchCenterXRef = useRef(0);
    const persistTimerRef = useRef(null);
    const dispatch = useDispatch();

    // Activate doppler neighbor calculation hook
    useDopplerNeighbors();
    const {
        waterFallVisualWidth,
        waterFallCanvasWidth,
        waterFallCanvasHeight,
        bandScopeHeight,
        bandscopeTopPadding = 0,
        waterFallScaleX,
        waterFallPositionX,
        frequencyScaleHeight,
        autoDBRange,
        bookmarks,
        isRecording,
        isStreaming,
        selectedSDRId,
    } = useSelector((state) => state.waterfall);

    // Add state for bookmarks
    const [visualContainerWidth, setVisualContainerWidth] = useState(waterFallCanvasWidth);

    // Track playback countdown for display
    const [playbackCountdown, setPlaybackCountdown] = useState(0);

    // Update playback countdown from ref
    useEffect(() => {
        if (!isStreaming || !playbackRemainingSecondsRef) {
            setPlaybackCountdown(0);
            return;
        }

        const updateCountdown = () => {
            const remaining = playbackRemainingSecondsRef.current;
            if (remaining !== null && remaining >= 0) {
                setPlaybackCountdown(remaining);
            } else {
                setPlaybackCountdown(0);
            }
        };

        // Initial update
        updateCountdown();

        // Update every 100ms for smooth countdown
        const intervalId = setInterval(updateCountdown, 100);

        return () => clearInterval(intervalId);
    }, [isStreaming, playbackRemainingSecondsRef]);

    // Function to recalculate position when the container resizes
    const handleResize = useCallback(() => {
        if (!containerRef.current || scaleRef.current <= 1) return;

        const newWidth = containerRef.current.clientWidth;
        const oldWidth = containerWidthRef.current;

        if (oldWidth === 0 || newWidth === oldWidth) return;

        // Calculate a new position based on scale and size change ratio
        // This keeps the visible content centered as the container resizes
        const centerPointRatio = 0.5; // Center of the view
        const oldCenterPoint = oldWidth * centerPointRatio;
        const newCenterPoint = newWidth * centerPointRatio;

        // Scale the center point positions
        const oldScaledCenter = (oldCenterPoint - positionXRef.current) / scaleRef.current;

        // Calculate the position to maintain the same content at the center
        const newPositionX = newCenterPoint - (oldScaledCenter * scaleRef.current);

        // Apply constraints to keep within bounds
        const maxPanLeft = newWidth - (newWidth * scaleRef.current);
        positionXRef.current = Math.max(maxPanLeft, Math.min(0, newPositionX));

        // Update width reference
        containerWidthRef.current = newWidth;

        // Apply transform (this now also updates React state)
        applyTransform();
    }, []);

    // Function to add a bookmark at a specific frequency
    const addBookmark = useCallback((frequency, label, color = '#ffff00') => {
        const newBookmark = {
            id: Date.now().toString(),
            frequency,
            label: label || `${(frequency / 1e6).toFixed(3)} MHz`,
            color
        };

        dispatch(setBookMarks([...bookmarks, newBookmark]));

    }, []);

    // Add a bookmark at the center frequency
    const addCenterFrequencyBookmark = useCallback(() => {
        addBookmark(
            centerFrequency,
            `Center ${(centerFrequency / 1e6).toFixed(3)} MHz`,
            '#00ffff'
        );
    }, [addBookmark, centerFrequency]);

    // Handle clicks on bookmarks
    const handleBookmarkClick = useCallback((bookmark) => {
        // Example: You could show a dialog to edit or delete the bookmark
        console.log('Clicked on bookmark:', bookmark);

        // For now, just log it, but you could add more advanced features here
    }, []);

    // Set up ResizeObserver to detect container size changes
    useEffect(() => {
        if (!containerRef.current) return;

        // Store initial width
        containerWidthRef.current = containerRef.current.clientWidth;

        // Create ResizeObserver
        const resizeObserver = new ResizeObserver(() => {
            handleResize();
        });

        // Start observing the container
        resizeObserver.observe(containerRef.current);

        return () => {
            resizeObserver.disconnect();
        };

    }, [handleResize]);

    // Apply a transform directly to a DOM element
    const applyTransform = useCallback(() => {
        if (containerRef.current) {
            containerRef.current.style.transform = `translateX(${positionXRef.current}px) scaleX(${scaleRef.current})`;
        }
    }, []);

    // Debounced persist function
    const persistToRedux = useCallback(() => {
        if (persistTimerRef.current) {
            clearTimeout(persistTimerRef.current);
        }
        persistTimerRef.current = setTimeout(() => {
            dispatch(setWaterFallScaleX(scaleRef.current));
            dispatch(setWaterFallPositionX(positionXRef.current));
        }, 300); // 300ms debounce
    }, [dispatch]);

    const checkMobile = () => {
        setIsMobile(/iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || window.innerWidth < 768);
    };

    useEffect(() => {
        // Detect mobile devices
        checkMobile();
        window.addEventListener('resize', checkMobile);

        // Restore scale and position from Redux on mount
        scaleRef.current = waterFallScaleX;
        positionXRef.current = waterFallPositionX;
        applyTransform();

        return () => {
            window.removeEventListener('resize', checkMobile);
            // Clear any pending persist operations
            if (persistTimerRef.current) {
                clearTimeout(persistTimerRef.current);
            }
        }
    }, []);

    // Zoom functionality
    const zoomOnXAxisOnly = useCallback((deltaScale, centerX) => {
        const prevScale = scaleRef.current;
        const newScale = Math.max(minZoom, Math.min(maxZoom, prevScale + deltaScale));

        // Exit if the scale didn't change
        if (newScale === prevScale) return;

        const containerWidth = containerRef.current?.clientWidth || 0;
        containerWidthRef.current = containerWidth;

        // Calculate how far from the left edge the center point is (as a ratio of scaled width)
        const mousePointRatio = (centerX - positionXRef.current) / (containerWidth * prevScale);

        // Calculate a new position
        let newPositionX = 0;
        if (newScale === 1) {
            // Reset position at scale 1
            newPositionX = 0;
        } else {
            // Keep the point under mouse at the same relative position
            newPositionX = centerX - mousePointRatio * containerWidth * newScale;

            // Constrain to boundaries
            const maxPanLeft = containerWidth - (containerWidth * newScale);
            newPositionX = Math.max(maxPanLeft, Math.min(0, newPositionX));
        }

        // Update refs
        scaleRef.current = newScale;
        positionXRef.current = newPositionX;

        // Apply the transform immediately
        applyTransform();

        // Persist to Redux (debounced)
        persistToRedux();

    }, [applyTransform, persistToRedux]);

    // Panning functionality
    const panOnXAxisOnly = useCallback((deltaX) => {
        // Only allow panning if zoomed in
        if (scaleRef.current <= 1) {
            return;
        }

        const containerWidth = containerRef.current?.clientWidth || 0;

        // Calculate boundaries
        const scaledWidth = containerWidth * scaleRef.current;
        const maxPanLeft = containerWidth - scaledWidth;

        // Update position with constraints
        positionXRef.current = Math.max(
            maxPanLeft,
            Math.min(0, positionXRef.current + deltaX)
        );

        // Apply transform directly
        applyTransform();
    }, [applyTransform]);

    // Reset to the default state
    const resetCustomTransform = useCallback(() => {
        scaleRef.current = 1;
        positionXRef.current = 0;

        applyTransform();
    }, [applyTransform]);

    // Set up all event handlers
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        // Wheel event for zooming
        const handleWheel = (e) => {
            //e.preventDefault();
            // Only zoom when shift key is pressed
            if (!e.shiftKey) {
                return;
            }
            const deltaScale = -e.deltaY * 0.01;
            zoomOnXAxisOnly(deltaScale, e.offsetX);
        };

        // Mouse events for panning
        const handleMouseDown = (e) => {
            isDraggingRef.current = true;
            lastXRef.current = e.clientX;
            // Prevent text selection during drag
            e.preventDefault();
            // Set cursor to indicate dragging
            container.style.cursor = 'grabbing';
        };

        const handleMouseMove = (e) => {
            if (!isDraggingRef.current) return;

            const deltaX = e.clientX - lastXRef.current;
            lastXRef.current = e.clientX;

            // Call pan function with the delta
            panOnXAxisOnly(deltaX);
        };

        const handleMouseUp = () => {
            isDraggingRef.current = false;
            // Reset cursor
            if (container) {
                container.style.cursor = 'grab';
            }
            // Persist after dragging ends
            persistToRedux();
        };

        // Touch events
        const handleTouchStart = (e) => {
            if (e.touches.length === 1) {
                isDraggingRef.current = true;
                lastXRef.current = e.touches[0].clientX;
                //e.preventDefault();
            } else if (e.touches.length === 2) {
                // Pinch-to-zoom
                const touch1 = e.touches[0];
                const touch2 = e.touches[1];
                lastPinchDistanceRef.current = Math.hypot(
                    touch2.clientX - touch1.clientX,
                    touch2.clientY - touch1.clientY
                );
                pinchCenterXRef.current = (touch1.clientX + touch2.clientX) / 2;
                e.preventDefault();
            }
        };

        const handleTouchMove = (e) => {
            // Single touch = pan
            if (e.touches.length === 1 && isDraggingRef.current) {
                const deltaX = e.touches[0].clientX - lastXRef.current;
                lastXRef.current = e.touches[0].clientX;
                panOnXAxisOnly(deltaX);
                //e.preventDefault();
            }

            // Two touches = pinch zoom
            else if (e.touches.length === 2) {
                const touch1 = e.touches[0];
                const touch2 = e.touches[1];
                const currentDistance = Math.hypot(
                    touch2.clientX - touch1.clientX,
                    touch2.clientY - touch1.clientY
                );

                const deltaScale = (currentDistance - lastPinchDistanceRef.current) * 0.01;
                lastPinchDistanceRef.current = currentDistance;

                pinchCenterXRef.current = (touch1.clientX + touch2.clientX) / 2;

                zoomOnXAxisOnly(deltaScale, pinchCenterXRef.current);
                e.preventDefault();
            }
        };

        const handleTouchEnd = () => {
            isDraggingRef.current = false;
            // Persist after touch interaction ends
            persistToRedux();
        };

        // Set initial cursor
        container.style.cursor = 'grab';

        // Add all event listeners
        container.addEventListener('wheel', handleWheel, {passive: false});
        container.addEventListener('mousedown', handleMouseDown);
        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);

        // For touch events, passive: false is critical for preventDefault to work
        container.addEventListener('touchstart', handleTouchStart, {passive: false});
        container.addEventListener('touchmove', handleTouchMove, {passive: false});
        window.addEventListener('touchend', handleTouchEnd);

        // Cleanup
        return () => {
            container.removeEventListener('wheel', handleWheel);
            container.removeEventListener('mousedown', handleMouseDown);
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);

            container.removeEventListener('touchstart', handleTouchStart);
            container.removeEventListener('touchmove', handleTouchMove);
            window.removeEventListener('touchend', handleTouchEnd);
        };
    }, [persistToRedux]);

    // Expose functions to parent component
    useImperativeHandle(ref, () => ({
        zoomOnXAxisOnly,
        panOnXAxisOnly,
        resetCustomTransform,
        getCurrentScale: () => scaleRef.current,
        getCurrentPosition: () => positionXRef.current,
        getContainerWidth: () => containerWidthRef.current,
    }), [zoomOnXAxisOnly, panOnXAxisOnly, resetCustomTransform]);

    // Set touch actions for mobile scrolling
    useEffect(() => {
        const canvases = [
            bandscopeCanvasRef.current,
            waterFallCanvasRef.current
        ];

        canvases.forEach(canvas => {
            if (canvas) {
                canvas.style.touchAction = 'pan-y';
            }
        });
    }, [bandscopeCanvasRef, waterFallCanvasRef]);

    return (
        <Box sx={{
            height: 'calc(100% - 90px)',
            width: '100%',
            overflow: 'hidden',
            touchAction: 'pan-y',
            position: 'relative',
        }}>
            {/* Recording indicator overlay - outside transformed container */}
            {isRecording && (
                <Box
                    sx={{
                        position: 'absolute',
                        top: 8,
                        left: 8,
                        backgroundColor: 'rgba(255, 0, 0, 0.85)',
                        color: 'white',
                        padding: '4px 8px',
                        borderRadius: '4px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 0.5,
                        fontSize: '0.75rem',
                        fontWeight: 'bold',
                        zIndex: 1000,
                        pointerEvents: 'none',
                        animation: 'pulse 2s ease-in-out infinite',
                        '@keyframes pulse': {
                            '0%, 100%': { opacity: 1 },
                            '50%': { opacity: 0.7 },
                        },
                    }}
                >
                    <Box
                        sx={{
                            width: 8,
                            height: 8,
                            borderRadius: '50%',
                            backgroundColor: 'white',
                        }}
                    />
                    REC
                </Box>
            )}
            {/* Playback indicator overlay - outside transformed container */}
            {isStreaming && selectedSDRId === 'sigmf-playback' && (
                <Box
                    sx={{
                        position: 'absolute',
                        top: 8,
                        left: 8,
                        backgroundColor: 'rgba(33, 150, 243, 0.85)',
                        color: 'white',
                        padding: '4px 8px',
                        borderRadius: '4px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 0.5,
                        fontSize: '0.75rem',
                        fontWeight: 'bold',
                        zIndex: 1000,
                        pointerEvents: 'none',
                        animation: 'pulse 2s ease-in-out infinite',
                        '@keyframes pulse': {
                            '0%, 100%': { opacity: 1 },
                            '50%': { opacity: 0.7 },
                        },
                    }}
                >
                    <Box
                        sx={{
                            width: 0,
                            height: 0,
                            borderLeft: '6px solid white',
                            borderTop: '4px solid transparent',
                            borderBottom: '4px solid transparent',
                        }}
                    />
                    PLAYBACK {playbackCountdown > 0 && `${Math.floor(playbackCountdown / 60)}:${String(Math.floor(playbackCountdown % 60)).padStart(2, '0')}`}
                </Box>
            )}

            {/* Canvases */}
            <Box
                ref={containerRef}
                sx={{
                    width: '100%',
                    height: 'auto',
                    position: 'relative',
                    display: 'flex',
                    flexDirection: 'column',
                    transformOrigin: 'left center',
                    touchAction: 'pan-y',
                }}
            >
                {/* Bandscope container with relative positioning */}
                <Box sx={{position: 'relative', height: `${bandScopeHeight + bandscopeTopPadding}px`}}>
                    <canvas
                        className={"bandscope-canvas"}
                        ref={bandscopeCanvasRef}
                        width={waterFallCanvasWidth}
                        height={bandScopeHeight}
                        style={{
                            imageRendering: 'auto',
                            width: '100%',
                            height: `${bandScopeHeight}px`,
                            borderBottom: `1px solid ${theme.palette.border.main}`,
                            display: 'block',
                            touchAction: 'pan-y',
                            transform: 'translateZ(0)',
                            backfaceVisibility: 'hidden',
                            perspective: '1000px',
                            marginTop: `${bandscopeTopPadding}px`,
                        }}
                    />
                    <BookmarkCanvas
                        centerFrequency={centerFrequency}
                        sampleRate={sampleRate}
                        containerWidth={visualContainerWidth}
                        height={bandScopeHeight + bandscopeTopPadding}
                        topPadding={bandscopeTopPadding}
                        onBookmarkClick={handleBookmarkClick}
                    />
                    {/* Add the new FrequencyBandOverlay component */}
                    <FrequencyBandOverlay
                        centerFrequency={centerFrequency}
                        sampleRate={sampleRate}
                        containerWidth={visualContainerWidth}
                        height={bandScopeHeight + bandscopeTopPadding}
                        topPadding={bandscopeTopPadding}
                        bands={frequencyBands}
                        bandHeight={20}
                        zoomScale={scaleRef.current}
                        panOffset={positionXRef.current}
                    />
                    <VFOMarkersContainer
                        centerFrequency={centerFrequency}
                        sampleRate={sampleRate}
                        waterfallHeight={waterFallCanvasHeight}
                        bandscopeHeight={bandScopeHeight}
                        bandscopeTopPadding={bandscopeTopPadding}
                        containerWidth={containerWidthRef.current}
                        zoomScale={scaleRef.current}
                        currentPositionX={positionXRef.current}
                    />
                </Box>

                <FrequencyScale
                    centerFrequency={centerFrequency}
                    containerWidth={visualContainerWidth}
                    sampleRate={sampleRate}
                />

                <canvas
                    className={"waterfall-canvas"}
                    ref={waterFallCanvasRef}
                    width={waterFallCanvasWidth}
                    height={waterFallCanvasHeight}
                    style={{
                        imageRendering: 'smooth',
                        WebkitFontSmoothing: 'antialiased',
                        width: '100%',
                        height: `${waterFallCanvasHeight}px`,
                        backgroundColor: theme.palette.background.default,
                        display: 'block',
                        touchAction: 'pan-y',
                        transform: 'translateZ(0)', // this it breaks box-shadow CSS
                        backfaceVisibility: 'hidden',
                        perspective: '1000px',
                    }}
                />
            </Box>

        </Box>
    );
});

export default WaterfallAndBandscope;