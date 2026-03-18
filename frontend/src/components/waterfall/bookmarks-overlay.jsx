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
    

import React, { useRef, useEffect, useState, useCallback } from 'react';
import {humanizeFrequency, preciseHumanizeFrequency} from "../common/common.jsx";
import {useDispatch, useSelector} from "react-redux";
import {
    setBookMarks
} from "./waterfall-slice.jsx";
import { useTheme } from '@mui/material/styles';


const BookmarkCanvas = ({
                            centerFrequency,
                            sampleRate,
                            containerWidth,
                            height,
                            onBookmarkClick = null
                        }) => {
    const dispatch = useDispatch();
    const theme = useTheme();
    const canvasRef = useRef(null);
    const bookmarkContainerRef = useRef(null);
    const [actualWidth, setActualWidth] = useState(2048);
    const lastMeasuredWidthRef = useRef(0);
    const rigDataRef = useRef({});

    // Update the ref when rigData changes (but don't react to these changes)
    const rigData = useSelector(state => state.targetSatTrack.rigData);

    const {
        bookmarks,
        neighboringTransmitters,
        showNeighboringTransmitters,
        showBookmarkSources,
    } = useSelector((state) => state.waterfall);

    const {
        availableTransmitters,
        satelliteData,
    } = useSelector((state) => state.targetSatTrack);

    // Calculate frequency range
    const startFreq = centerFrequency - sampleRate / 2;
    const endFreq = centerFrequency + sampleRate / 2;

    const updateActualWidth = useCallback(() => {
        // Get the actual client dimensions of the element
        const rect = bookmarkContainerRef.current?.getBoundingClientRect();

        // Only update if the width has changed significantly (avoid unnecessary redraws)
        if (rect && Math.abs(rect.width - lastMeasuredWidthRef.current) > 1) {
            if (rect.width > 0) {
                lastMeasuredWidthRef.current = rect.width;
                setActualWidth(rect.width);
            }
        }
    }, []);

    // Function to add a bookmark at a specific frequency
    const makeBookMark = (frequency, label, color, metadata = {}) => {
        return {
            frequency,
            label,
            color,
            metadata,
        };
    };

    // Poll for container width changes
    useEffect(() => {
        const interval = setInterval(() => {
            updateActualWidth();
        }, 100);

        return () => {
            clearInterval(interval);
        };
    }, [updateActualWidth]);

    // Update width when the container width changes
    useEffect(() => {
        updateActualWidth();
    }, [containerWidth, updateActualWidth]);

    // Helper function to compare bookmarks arrays
    function areBookmarksEqual(bookmarksA, bookmarksB) {
        if (bookmarksA.length !== bookmarksB.length) return false;

        // Deep comparison of each bookmark
        for (let i = 0; i < bookmarksA.length; i++) {
            const a = bookmarksA[i];
            const b = bookmarksB[i];

            // Simple comparison of important fields
            if (a.frequency !== b.frequency ||
                a.label !== b.label ||
                a.color !== b.color ||
                a.metadata?.type !== b.metadata?.type ||
                a.metadata?.transmitter_id !== b.metadata?.transmitter_id) {
                return false;
            }
        }
        return true;
    }

    // Merged effect: Create transmitter, doppler-shifted, and neighboring transmitter bookmarks
    useEffect(() => {
        const normalizeSource = (source) => {
            if (typeof source !== 'string') {
                return 'manual';
            }
            const lowered = source.toLowerCase();
            if (lowered === 'manual' || lowered === 'satdump' || lowered === 'satnogs' || lowered === 'gr-satellites') {
                return lowered;
            }
            return 'manual';
        };

        const isSourceEnabled = (source) => {
            const normalized = normalizeSource(source);
            if (!showBookmarkSources) {
                return true;
            }
            return Boolean(showBookmarkSources[normalized]);
        };

        // 1. Create static transmitter bookmarks from availableTransmitters
        const transmitterBookmarks = [];
        availableTransmitters.forEach(transmitter => {
            if (!isSourceEnabled(transmitter.source)) {
                return;
            }
            const isActive = transmitter['status'] === 'active';
            transmitterBookmarks.push(makeBookMark(
                transmitter['downlink_low'],
                `${transmitter['description']} (${preciseHumanizeFrequency(transmitter['downlink_low'])})`,
                isActive ? theme.palette.success.main : theme.palette.grey[500],
                {
                    type: 'transmitter',
                    transmitter_id: transmitter['id'],
                    active: isActive
                }
            ));
        });

        // 2. Create doppler-shifted bookmarks from rigData (tracked satellite)
        const transmittersWithDoppler = rigData['transmitters'] || [];
        const dopplerBookmarks = transmittersWithDoppler
            .filter(transmitter => transmitter.downlink_observed_freq > 0 && isSourceEnabled(transmitter.source))
            .map(transmitter => ({
                frequency: transmitter.downlink_observed_freq,
                label: `${satelliteData['details']['name']} - ${transmitter.description || 'Unknown'} - Corrected: ${preciseHumanizeFrequency(transmitter.downlink_observed_freq)}`,
                color: theme.palette.warning.main,
                metadata: {
                    type: 'doppler_shift',
                    transmitter_id: transmitter.id
                }
            }));

        // 3. Create neighboring transmitter bookmarks (from groupOfSats) - only if enabled
        const neighborBookmarks = showNeighboringTransmitters
            ? neighboringTransmitters
                .filter(tx => isSourceEnabled(tx.source))
                .map(tx => {
                // Check if this is a grouped transmitter
                const label = tx.is_group
                    ? `${tx.satellite_name} (${tx.group_count})`
                    : tx.satellite_name;

                return {
                    frequency: tx.doppler_frequency,
                    label: label,
                    color: theme.palette.info.main,
                    metadata: {
                        type: 'neighbor_transmitter',
                        transmitter_id: tx.id,
                        satellite_norad_id: tx.satellite_norad_id,
                        doppler_shift: tx.doppler_shift,
                        is_group: tx.is_group || false,
                        group_count: tx.group_count || 1
                    }
                };
            })
            : [];

        // 4. Combine all types of bookmarks
        const updatedBookmarks = [...transmitterBookmarks, ...dopplerBookmarks, ...neighborBookmarks];

        // 5. Only dispatch if bookmarks actually changed
        if (!areBookmarksEqual(bookmarks, updatedBookmarks)) {
            dispatch(setBookMarks(updatedBookmarks));
        }
    }, [availableTransmitters, rigData, satelliteData, neighboringTransmitters, showNeighboringTransmitters, showBookmarkSources, theme.palette.success.main, theme.palette.warning.main, theme.palette.info.main, theme.palette.grey]);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) {
            return;
        }

        const ctx = canvas.getContext('2d', { willReadFrequently: true});

        // Set canvas width based on actual measured width
        canvas.width = actualWidth;
        canvas.height = height;

        // Clear the canvas with a transparent background
        ctx.clearRect(0, 0, canvas.width, height);

        // Calculate frequency range
        const freqRange = endFreq - startFreq;

        // Constants for label sizing
        const textHeight = 14;
        const padding = 4;
        const labelGap = 2; // Extra spacing between stacked labels
        const verticalSpacing = textHeight + padding * 2 + labelGap; // Total height of a label plus gap
        const baseY = 16; // Base Y position for the first label
        const bookmarkLabelOffset = 20; // Vertical offset from base position for bookmark labels

        // First, identify all transmitter IDs that have doppler shift bookmarks
        // We'll use this to skip the corresponding transmitter bookmarks
        const transmitterIdsWithDoppler = new Set();
        bookmarks.forEach(bookmark => {
            if (bookmark.metadata?.type === 'doppler_shift' && bookmark.metadata?.transmitter_id) {
                transmitterIdsWithDoppler.add(bookmark.metadata.transmitter_id);
            }
        });

        // Draw bookmarks in order: neighbors first (bottom layer), then main transmitters and doppler (top layer)
        if (bookmarks.length) {
            // Separate bookmarks by type for layered rendering
            const neighborBookmarks = bookmarks.filter(b => b.metadata?.type === 'neighbor_transmitter');
            const mainBookmarks = bookmarks.filter(b => b.metadata?.type !== 'neighbor_transmitter');

            let visibleBookmarkIndex = 0;

            // Draw neighbor transmitters first (bottom layer)
            neighborBookmarks.forEach((bookmark) => {
                // Skip if the bookmark is outside the visible range
                if (bookmark.frequency < startFreq || bookmark.frequency > endFreq) {
                    return;
                }

                // Calculate x position based on frequency
                const x = ((bookmark.frequency - startFreq) / freqRange) * canvas.width;

                // Check if this is an inactive transmitter for line styling
                const isInactiveTransmitter = false; // Neighbors are always active
                const isNeighborTransmitter = true;

                // Draw a downward-pointing arrow at the bottom of the canvas
                ctx.beginPath();
                const arrowSize = 6;
                const arrowY = height - arrowSize; // Position at bottom of canvas

                // Draw the arrow path
                ctx.moveTo(x - arrowSize, arrowY);
                ctx.lineTo(x + arrowSize, arrowY);
                ctx.lineTo(x, height);
                ctx.closePath();

                // Fill the arrow for neighbor transmitters
                ctx.fillStyle = bookmark.color || theme.palette.info.main;
                ctx.globalAlpha = 1.0;
                ctx.fill();

                // Variable to store the label bottom Y position for the dotted line
                let labelBottomY = 0;

                // Display label at top with alternating heights
                if (bookmark.label) {
                    // Calculate label vertical position based on index
                    const labelOffset = (visibleBookmarkIndex % 3) * verticalSpacing;
                    const labelY = baseY + labelOffset + 35 + bookmarkLabelOffset + verticalSpacing - 5;

                    // Store the bottom edge of the label box (south edge)
                    labelBottomY = labelY + textHeight + padding * 2;

                    const fontSize = '10px';

                    ctx.font = `${fontSize} Arial`;
                    ctx.fillStyle = bookmark.color || theme.palette.info.main;
                    ctx.textAlign = 'center';

                    // Add semi-transparent background
                    const textMetrics = ctx.measureText(bookmark.label);
                    const textWidth = textMetrics.width;
                    const radius = 3;

                    ctx.beginPath();
                    ctx.roundRect(
                        x - textWidth / 2 - padding,
                        labelY - padding,
                        textWidth + padding * 2,
                        textHeight + padding * 2,
                        radius
                    );
                    const bgColor = theme.palette.background.paper;
                    ctx.fillStyle = bgColor.startsWith('#')
                        ? bgColor + 'E6'
                        : bgColor.replace(')', ', 0.9)');
                    ctx.fill();

                    // Add subtle border
                    ctx.strokeStyle = bookmark.color || theme.palette.info.main;
                    ctx.globalAlpha = 0.3;
                    ctx.lineWidth = 1;
                    ctx.stroke();
                    ctx.globalAlpha = 1.0;

                    // Draw the text
                    ctx.shadowBlur = 2;
                    ctx.shadowColor = theme.palette.mode === 'dark' ? 'rgba(0, 0, 0, 0.8)' : 'rgba(255, 255, 255, 0.8)';
                    ctx.globalAlpha = 1.0;
                    ctx.fillStyle = bookmark.color || theme.palette.info.main;
                    ctx.fillText(bookmark.label, x, labelY + textHeight - padding);
                    ctx.globalAlpha = 1.0;

                    // Draw dotted line from bottom of canvas to south edge of label
                    ctx.beginPath();
                    ctx.strokeStyle = bookmark.color || theme.palette.info.main;
                    ctx.lineWidth = 0.8;
                    ctx.setLineDash([2, 4]);
                    ctx.globalAlpha = 0.9;
                    ctx.moveTo(x, height); // Start from bottom
                    ctx.lineTo(x, labelBottomY); // End at south edge of label
                    ctx.stroke();
                    ctx.setLineDash([]); // Reset dash pattern
                    ctx.globalAlpha = 1.0;

                    // Increment the visible bookmark index
                    visibleBookmarkIndex++;
                }

                // Reset shadow
                ctx.shadowBlur = 0;
            });

            // Reset visible index for main bookmarks layer
            visibleBookmarkIndex = 0;

            // Draw main transmitters and doppler markers (top layer)
            mainBookmarks.forEach((bookmark) => {
                // Skip if the bookmark is outside the visible range
                if (bookmark.frequency < startFreq || bookmark.frequency > endFreq) {
                    return;
                }

                // Skip transmitter bookmarks that have a corresponding doppler shift bookmark
                if (bookmark.metadata?.type === 'transmitter' &&
                    bookmark.metadata?.transmitter_id &&
                    transmitterIdsWithDoppler.has(bookmark.metadata.transmitter_id)) {
                    return;
                }

                // Calculate x position based on frequency
                const x = ((bookmark.frequency - startFreq) / freqRange) * canvas.width;

                // Check if this is an inactive transmitter for line styling
                const isInactiveTransmitter = bookmark.metadata?.type === 'transmitter' && !bookmark.metadata?.active;

                // Draw a downward-pointing arrow at the bottom of the canvas
                ctx.beginPath();
                const arrowSize = isInactiveTransmitter ? 4 : 6;
                const arrowY = height - arrowSize; // Position at bottom of canvas

                // Draw the arrow path
                ctx.moveTo(x - arrowSize, arrowY);
                ctx.lineTo(x + arrowSize, arrowY);
                ctx.lineTo(x, height);
                ctx.closePath();

                // If the bookmark is a transmitter, draw a hollow arrow with colored outline
                if (bookmark.metadata?.type === 'transmitter') {
                    ctx.strokeStyle = bookmark.color || theme.palette.warning.main;
                    ctx.lineWidth = isInactiveTransmitter ? 1 : 2;
                    ctx.globalAlpha = isInactiveTransmitter ? 0.5 : 1.0;
                    ctx.stroke();

                } else {
                    // For all other bookmarks, fill the arrow
                    ctx.fillStyle = bookmark.color || theme.palette.warning.main;
                    ctx.globalAlpha = 1.0;
                    ctx.fill();
                }

                // Check if this is a doppler_shift type bookmark
                const isDopplerShift = bookmark.metadata?.type === 'doppler_shift';
                const isNeighborTransmitter = bookmark.metadata?.type === 'neighbor_transmitter';

                // Variable to store the label bottom Y position for the dotted line
                let labelBottomY = 0;

                // For regular bookmarks and neighbor transmitters - display at top with alternating heights
                if (bookmark.label && !isDopplerShift) {
                    // Calculate label vertical position based on index
                    // Use visibleBookmarkIndex to ensure proper alternating heights (3 rows)
                    const labelOffset = (visibleBookmarkIndex % 3) * verticalSpacing;
                    const labelY = baseY + labelOffset + 35 + bookmarkLabelOffset + verticalSpacing;

                    // Store the bottom edge of the label box (south edge)
                    labelBottomY = labelY + textHeight + padding * 2;

                    // Check if this is an inactive transmitter or a neighbor transmitter
                    const isInactive = bookmark.metadata?.type === 'transmitter' && !bookmark.metadata?.active;
                    // Use slightly smaller font for neighbor transmitters to differentiate
                    const fontSize = isInactive ? '9px' : (isNeighborTransmitter ? '10px' : '11px');

                    ctx.font = `${fontSize} Arial`;
                    ctx.fillStyle = bookmark.color || theme.palette.warning.main;
                    ctx.textAlign = 'center';

                    // Add semi-transparent background
                    const textMetrics = ctx.measureText(bookmark.label);
                    const textWidth = textMetrics.width;
                    const radius = 3;

                    ctx.beginPath();
                    ctx.roundRect(
                        x - textWidth / 2 - padding,
                        labelY - padding,
                        textWidth + padding * 2,
                        textHeight + padding * 2,
                        radius
                    );
                    const bgColor = theme.palette.background.paper;
                    ctx.fillStyle = bgColor.startsWith('#')
                        ? bgColor + 'E6'
                        : bgColor.replace(')', ', 0.9)');
                    ctx.fill();

                    // Add subtle border
                    ctx.strokeStyle = bookmark.color || theme.palette.warning.main;
                    ctx.globalAlpha = isInactive ? 0.2 : 0.3;
                    ctx.lineWidth = 1;
                    ctx.stroke();
                    ctx.globalAlpha = 1.0;

                    // Draw the text
                    ctx.shadowBlur = 2;
                    ctx.shadowColor = theme.palette.mode === 'dark' ? 'rgba(0, 0, 0, 0.8)' : 'rgba(255, 255, 255, 0.8)';
                    ctx.globalAlpha = isInactive ? 0.6 : 1.0;
                    ctx.fillStyle = bookmark.color || theme.palette.warning.main;
                    ctx.fillText(bookmark.label, x, labelY + textHeight - padding);
                    ctx.globalAlpha = 1.0;

                    // Draw dotted line from bottom of canvas to south edge of label
                    ctx.beginPath();
                    ctx.strokeStyle = bookmark.color || theme.palette.warning.main;
                    ctx.lineWidth = isInactiveTransmitter ? 0.5 : 0.8;
                    ctx.setLineDash([2, 4]);
                    ctx.globalAlpha = isInactiveTransmitter ? 0.4 : 0.9;
                    ctx.moveTo(x, height); // Start from bottom
                    ctx.lineTo(x, labelBottomY); // End at south edge of label
                    ctx.stroke();
                    ctx.setLineDash([]); // Reset dash pattern
                    ctx.globalAlpha = 1.0;

                    // Increment the visible bookmark index only for non-doppler bookmarks
                    visibleBookmarkIndex++;
                }

                // For doppler_shift bookmarks - track their index separately for stacking
                if (bookmark.label && isDopplerShift) {
                    // Find the index of this doppler bookmark among all doppler bookmarks
                    const dopplerBookmarks = bookmarks.filter(b =>
                        b.metadata?.type === 'doppler_shift' &&
                        b.frequency >= startFreq &&
                        b.frequency <= endFreq
                    );
                    const dopplerIndex = dopplerBookmarks.findIndex(b =>
                        b.metadata?.transmitter_id === bookmark.metadata?.transmitter_id
                    );

                    ctx.font = '11px Arial';
                    ctx.fillStyle = bookmark.color || theme.palette.info.main;
                    ctx.textAlign = 'center';

                    // Calculate label vertical position based on doppler index (alternating heights - 3 rows)
                    const dopplerLabelOffset = (dopplerIndex % 3) * verticalSpacing;
                    const dopplerLabelY = 50 + bookmarkLabelOffset - padding - textHeight + dopplerLabelOffset + verticalSpacing - 30;

                    // Store the bottom edge of the doppler label box (south edge)
                    labelBottomY = dopplerLabelY + textHeight + padding * 2;

                    // Add semi-transparent background
                    const textMetrics = ctx.measureText(bookmark.label);
                    const textWidth = textMetrics.width;
                    const radius = 3;

                    ctx.beginPath();
                    ctx.roundRect(
                        x - textWidth / 2 - padding,
                        dopplerLabelY - padding,
                        textWidth + padding * 2,
                        textHeight + padding * 2,
                        radius
                    );
                    const bgColor = theme.palette.background.paper;
                    ctx.fillStyle = bgColor.startsWith('#')
                        ? bgColor + 'B3'
                        : bgColor.replace(')', ', 0.7)');
                    ctx.fill();

                    // Add subtle border
                    ctx.strokeStyle = bookmark.color || theme.palette.info.main;
                    ctx.globalAlpha = 0.3;
                    ctx.lineWidth = 1;
                    ctx.stroke();
                    ctx.globalAlpha = 1.0;

                    // Draw the text
                    ctx.shadowBlur = 2;
                    ctx.shadowColor = theme.palette.mode === 'dark' ? 'rgba(0, 0, 0, 0.8)' : 'rgba(255, 255, 255, 0.8)';
                    ctx.globalAlpha = 1.0;
                    ctx.fillStyle = bookmark.color || theme.palette.info.main;
                    ctx.fillText(bookmark.label, x, dopplerLabelY + textHeight - padding);

                    // Draw dotted line from bottom of canvas to south edge of doppler label
                    ctx.beginPath();
                    ctx.strokeStyle = bookmark.color || theme.palette.warning.main;
                    ctx.lineWidth = 0.8;
                    ctx.setLineDash([2, 4]);
                    ctx.globalAlpha = 0.9;
                    ctx.moveTo(x, height); // Start from bottom
                    ctx.lineTo(x, labelBottomY); // End at south edge of label
                    ctx.stroke();
                    ctx.setLineDash([]); // Reset dash pattern
                    ctx.globalAlpha = 1.0;
                }

                // Reset shadow
                ctx.shadowBlur = 0;
            });
        }
    }, [bookmarks, centerFrequency, sampleRate, actualWidth, height]);

    // Handle click events on the canvas
    const handleCanvasClick = useCallback((e) => {
        if (!onBookmarkClick) return;

        const canvas = canvasRef.current;
        const rect = canvas.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const widthRatio = canvas.width / rect.width;
        const canvasX = clickX * widthRatio;

        // Calculate which bookmark was clicked (if any)
        const freqRange = endFreq - startFreq;

        // Convert click position to frequency
        const clickedFreq = startFreq + (canvasX / canvas.width) * freqRange;

        // Find the bookmark closest to the click (within a threshold)
        const threshold = sampleRate * 0.01; // 1% of the frequency range
        const clickedBookmark = bookmarks.find(bookmark =>
            Math.abs(bookmark.frequency - clickedFreq) < threshold
        );

        if (clickedBookmark) {
            onBookmarkClick(clickedBookmark);
        }
    }, [bookmarks, onBookmarkClick, startFreq, endFreq, sampleRate]);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || !onBookmarkClick) return;

        canvas.addEventListener('click', handleCanvasClick);

        return () => {
            canvas.removeEventListener('click', handleCanvasClick);
        };
    }, [handleCanvasClick, onBookmarkClick]);

    return (
        <div
            ref={bookmarkContainerRef}
            style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: `${height}px`,
                pointerEvents: onBookmarkClick ? 'auto' : 'none',
            }}
        >
            <canvas
                className={'bookmark-canvas'}
                ref={canvasRef}
                width={actualWidth}
                height={height}
                style={{
                    display: 'block',
                    width: '100%',
                    height: '100%',
                    touchAction: 'pan-y',
                }}
            />
        </div>
    );
};

export default BookmarkCanvas;
