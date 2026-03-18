import React, { useRef, useEffect } from 'react';
import { Box, Typography, useTheme } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { Y_AXIS_WIDTH, X_AXIS_HEIGHT, Y_AXIS_TOP_MARGIN, elevationToYPercent } from './timeline-constants.jsx';

/**
 * PassCurve component - Renders a single satellite pass as an SVG path
 */
export const PassCurve = ({ pass, startTime, endTime, labelType = false, labelVerticalOffset = 150, geoIndex = null, totalGeoSats = null, highlightActivePasses = false }) => {
  const theme = useTheme();

  // Color based on peak altitude
  const getColor = () => {
    if (pass.isCurrent) {
      return theme.palette.success.main;
    }
    if (pass.peak_altitude < 10) return theme.palette.error.main; // Red for below 10°
    if (pass.peak_altitude <= 45) return theme.palette.grey[500]; // Grey/white for 10-45°
    return theme.palette.success.main; // Green for above 45°
  };

  // Split elevation curve into segments whenever elevation goes below 0
  const curveSegments = [];
  const pathDataSegments = [];

  // Check if we have actual elevation curve data
  const hasElevationCurve = pass.elevation_curve && pass.elevation_curve.length > 0;

  if (hasElevationCurve) {
    const totalDuration = endTime.getTime() - startTime.getTime();

    // First, filter points to only those within the time window
    let pointsInWindow = [];
    let beforePoint = null;
    let afterPoint = null;

    pass.elevation_curve.forEach((point) => {
      const pointTime = new Date(point.time).getTime();

      if (pointTime < startTime.getTime()) {
        // Keep updating beforePoint - we want the closest one to window start
        beforePoint = point;
      } else if (pointTime > endTime.getTime()) {
        // Keep only the first point after window end
        if (!afterPoint) {
          afterPoint = point;
        }
      } else {
        // Point is inside the window
        pointsInWindow.push(point);
      }
    });

    // Build the full points list
    let allPoints = [];
    if (beforePoint) allPoints.push(beforePoint);
    allPoints = allPoints.concat(pointsInWindow);
    if (afterPoint) allPoints.push(afterPoint);

    // Now split into segments whenever elevation < 0
    let currentSegment = [];

    allPoints.forEach((point, i) => {
      if (point.elevation >= 0) {
        // Add point to current segment
        currentSegment.push(point);
      } else {
        // Elevation is negative - end current segment if it has points
        if (currentSegment.length > 0) {
          curveSegments.push(currentSegment);
          currentSegment = [];
        }
      }
    });

    // Add final segment if it has points
    if (currentSegment.length > 0) {
      curveSegments.push(currentSegment);
    }

    // Convert each segment's points to path data strings
    curveSegments.forEach((segment, idx) => {
      const segmentPath = [];
      const elevations = segment.map(p => p.elevation);

      segment.forEach((point) => {
        const pointTime = new Date(point.time).getTime();

        // Clamp to window bounds
        const clampedPointTime = Math.max(startTime.getTime(), Math.min(pointTime, endTime.getTime()));

        // Use UNIFIED COORDINATE SYSTEM
        // X: Time to percentage (0% = start, 100% = end)
        const x = ((clampedPointTime - startTime.getTime()) / totalDuration) * 100;

        // Y: Elevation to percentage (0% = 90° top, 100% = 0° bottom)
        const y = elevationToYPercent(point.elevation);

        segmentPath.push(`${x},${y}`);
      });

      // Only add segments with at least 2 points
      if (segmentPath.length >= 2) {
        pathDataSegments.push(segmentPath);
      }
    });
  } else {
    // Fallback: Show vertical line at peak_altitude when elevation curve is loading/missing
    // Calculate the midpoint of the pass duration
    const passStartTime = new Date(pass.event_start).getTime();
    const passEndTime = new Date(pass.event_end).getTime();
    const passMidpoint = (passStartTime + passEndTime) / 2;

    // Calculate position within the timeline window
    const totalDuration = endTime.getTime() - startTime.getTime();
    const xPercent = ((passMidpoint - startTime.getTime()) / totalDuration) * 100;

    // Create vertical line from 0° to peak_altitude
    const yBottom = elevationToYPercent(0);
    const yTop = elevationToYPercent(pass.peak_altitude);

    // Store as a single vertical line segment
    pathDataSegments.push([`${xPercent},${yBottom}`, `${xPercent},${yTop}`]);
  }

  if (pathDataSegments.length === 0) {
    return null;
  }

  // Find the peak point (highest elevation) for the label
  let peakPoint = null;
  let peakElevation = pass.peak_altitude || -Infinity;

  if (hasElevationCurve) {
    pass.elevation_curve.forEach((point) => {
      const pointTime = new Date(point.time).getTime();
      if (pointTime >= startTime.getTime() && pointTime <= endTime.getTime()) {
        if (point.elevation > peakElevation) {
          peakElevation = point.elevation;
          peakPoint = point;
        }
      }
    });
  }

  // Calculate peak position in chart coordinates
  let peakX = null;
  let peakY = null;

  // For geostationary satellites with horizontal distribution
  // Check if this pass was identified as geostationary (geoIndex will be non-null)
  if (geoIndex !== null && totalGeoSats !== null && totalGeoSats > 1) {
    // Distribute horizontally across the timeline, avoiding edges
    // Use 20% margins on each side = 60% usable space
    // Distribute satellites evenly within that space, with additional padding from the margins
    const marginPercent = 20;
    const usableSpacePercent = 60;
    const spacing = usableSpacePercent / (totalGeoSats + 1);
    peakX = marginPercent + (spacing * (geoIndex + 1));
    peakY = elevationToYPercent(peakElevation);
  } else if (geoIndex !== null && totalGeoSats === 1) {
    // Single geostationary satellite - place at center
    peakX = 50;
    peakY = elevationToYPercent(peakElevation);
  } else if (peakPoint) {
    const totalDuration = endTime.getTime() - startTime.getTime();
    const pointTime = new Date(peakPoint.time).getTime();
    peakX = ((pointTime - startTime.getTime()) / totalDuration) * 100;
    peakY = elevationToYPercent(peakPoint.elevation);
  } else {
    // Fallback: use middle of pass with peak_altitude (for vertical line fallback)
    const passStartTime = new Date(pass.event_start).getTime();
    const passEndTime = new Date(pass.event_end).getTime();
    const passMidpoint = (passStartTime + passEndTime) / 2;
    const totalDuration = endTime.getTime() - startTime.getTime();
    peakX = ((passMidpoint - startTime.getTime()) / totalDuration) * 100;
    peakY = elevationToYPercent(pass.peak_altitude || 0);
  }

  return (
    <>
      <svg
        style={{
          position: 'absolute',
          top: `${Y_AXIS_TOP_MARGIN}px`,
          left: `${Y_AXIS_WIDTH}px`,
          width: `calc(100% - ${Y_AXIS_WIDTH}px)`,
          height: `calc(100% - ${X_AXIS_HEIGHT + Y_AXIS_TOP_MARGIN}px)`,
          pointerEvents: 'none',
        }}
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
      >
        {pathDataSegments.map((pathData, segmentIndex) => {
          // Create SVG path from points
          const pathString = pathData.map((point, i) => {
            const [x, y] = point.split(',');
            return i === 0 ? `M ${x} ${y}` : `L ${x} ${y}`;
          }).join(' ');

          // Get first and last X coordinates for closing the fill path
          const firstX = pathData[0].split(',')[0];
          const lastX = pathData[pathData.length - 1].split(',')[0];
          const bottomY = 100; // 0° elevation at bottom

          // Create closed path for fill area
          const fillPath = `${pathString} L ${lastX} ${bottomY} L ${firstX} ${bottomY} Z`;

          return (
            <g key={segmentIndex}>
              {/* Fill area */}
              <path
                d={fillPath}
                fill={getColor()}
                fillOpacity={highlightActivePasses ? (pass.isCurrent ? 0.15 : 0.08) : 0.15}
                stroke="none"
                style={{ pointerEvents: 'none' }}
              />
              {/* Stroke line */}
              <path
                d={pathString}
                stroke={getColor()}
                strokeWidth="0.5"
                strokeDasharray={highlightActivePasses ? (pass.isCurrent ? "0" : "2,2") : "0"}
                fill="none"
                opacity={highlightActivePasses ? (pass.isCurrent ? 1 : 0.8) : (pass.isCurrent ? 1 : 0.8)}
                vectorEffect="non-scaling-stroke"
                style={{ pointerEvents: 'none' }}
              />
            </g>
          );
        })}
      </svg>

      {/* Label at peak - type and size based on labelType and elevation */}
      {labelType && peakX !== null && peakY !== null && peakElevation >= 0 && (() => {
        // Determine if we should show the label based on elevation threshold
        if (labelType === 'name' && peakElevation < 25) return null; // Don't show name labels below 25°
        if (labelType === 'peak' && peakElevation < 10) return null; // Don't show peak labels below 10°

        // Determine label content
        let labelContent = '';
        if (labelType === 'name') {
          labelContent = pass.name;
        } else if (labelType === 'peak') {
          labelContent = `${peakElevation.toFixed(0)}°`;
        }

        if (!labelContent) return null;

        // Determine label size based on elevation (for 'name' labels)
        let fontSize = '0.7rem';
        if (labelType === 'name' && peakElevation < 45) {
          fontSize = '0.6rem'; // Smaller font for low elevation passes (30-45°)
        }

        return (
          <Box
            sx={{
              position: 'absolute',
              left: `calc(${Y_AXIS_WIDTH}px + (100% - ${Y_AXIS_WIDTH}px) * ${peakX / 100})`,
              top: `calc(${Y_AXIS_TOP_MARGIN}px + (100% - ${Y_AXIS_TOP_MARGIN}px - ${X_AXIS_HEIGHT}px) * ${peakY / 100})`,
              transform: `translate(-50%, -${labelVerticalOffset}%)`,
              fontSize: fontSize,
              fontWeight: 'bold',
              color: getColor(),
              backgroundColor: theme.palette.background.paper,
              padding: '2px 6px',
              borderRadius: '3px',
              border: pass.isCurrent ? `1px solid ${getColor()}` : 'none',
              whiteSpace: 'nowrap',
              pointerEvents: 'none',
              zIndex: 25,
              opacity: highlightActivePasses ? (pass.isCurrent ? 0.9 : 0.5) : 0.9,
              boxShadow: theme.shadows[1],
            }}
          >
            {labelContent}
          </Box>
        );
      })()}
    </>
  );
};

/**
 * CurrentTimeMarker component - Renders the NOW marker showing current time
 * Uses CSS transforms and requestAnimationFrame for smooth movement without re-renders
 */
export const CurrentTimeMarker = ({ startTime, endTime }) => {
  const theme = useTheme();
  const { t } = useTranslation('target');

  const markerRef = useRef(null);
  const labelRef = useRef(null);
  const bottomLabelRef = useRef(null);
  const animationFrameRef = useRef(null);

  useEffect(() => {
    const updateMarkerPosition = () => {
      if (!markerRef.current) return;

      const now = Date.now();
      const totalDuration = endTime.getTime() - startTime.getTime();
      const position = ((now - startTime.getTime()) / totalDuration) * 100;

      // Don't render if position is negative (past the left edge)
      if (position < 0) {
        markerRef.current.style.display = 'none';
        if (labelRef.current) labelRef.current.style.display = 'none';
        if (bottomLabelRef.current) bottomLabelRef.current.style.display = 'none';
        animationFrameRef.current = requestAnimationFrame(updateMarkerPosition);
        return;
      }

      markerRef.current.style.display = 'block';
      if (labelRef.current) labelRef.current.style.display = 'block';
      if (bottomLabelRef.current) bottomLabelRef.current.style.display = 'block';

      // Calculate the translateX value to move the marker
      // Base position is Y_AXIS_WIDTH, then add percentage of remaining width
      const translateX = `calc(${Y_AXIS_WIDTH}px + (100% - ${Y_AXIS_WIDTH}px) * ${position / 100})`;

      // Update all elements
      if (markerRef.current) {
        markerRef.current.style.left = translateX;
      }
      if (labelRef.current) {
        labelRef.current.style.left = translateX;
      }
      if (bottomLabelRef.current) {
        bottomLabelRef.current.style.left = translateX;
      }

      // Continue animation
      animationFrameRef.current = requestAnimationFrame(updateMarkerPosition);
    };

    // Start animation loop
    animationFrameRef.current = requestAnimationFrame(updateMarkerPosition);

    // Cleanup
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [startTime, endTime]);

  return (
    <>
      {/* Vertical NOW line */}
      <Box
        ref={markerRef}
        sx={{
          position: 'absolute',
          left: 0, // Will be set by JS
          top: `${Y_AXIS_TOP_MARGIN}px`,
          bottom: `${X_AXIS_HEIGHT}px`,
          width: '1px',
          backgroundColor: theme.palette.error.main,
          zIndex: 20,
          boxShadow: `0 0 8px ${theme.palette.error.main}40`,
          willChange: 'left',
        }}
      />

      {/* NOW label at top, centered on line */}
      <Box
        ref={labelRef}
        sx={{
          position: 'absolute',
          left: 0, // Will be set by JS
          top: `${Y_AXIS_TOP_MARGIN + 3}px`,
          transform: 'translate(-50%, -100%)',
          fontSize: '0.65rem',
          fontWeight: 'bold',
          color: theme.palette.error.main,
          backgroundColor: theme.palette.background.paper,
          padding: '2px 6px',
          borderRadius: '2px',
          border: `1px solid ${theme.palette.error.main}`,
          whiteSpace: 'nowrap',
          zIndex: 20,
          willChange: 'left',
        }}
      >
        {t('timeline.now')}
      </Box>

      {/* Arrow at bottom pointing down */}
      <Box
        ref={bottomLabelRef}
        sx={{
          position: 'absolute',
          left: 0, // Will be set by JS
          bottom: `${X_AXIS_HEIGHT}px`,
          transform: 'translateX(-50%)',
          width: '0',
          height: '0',
          borderLeft: '6px solid transparent',
          borderRight: '6px solid transparent',
          borderTop: `8px solid ${theme.palette.error.main}`,
          zIndex: 20,
          filter: `drop-shadow(0 0 4px ${theme.palette.error.main}80)`,
          willChange: 'left',
        }}
      />
    </>
  );
};

/**
 * PassTooltipContent component - Renders tooltip content for a satellite pass
 */
export const PassTooltipContent = ({ pass, isCurrent, timezone = 'UTC' }) => {
  const { t } = useTranslation('target');

  const formatTime = (isoString) => {
    const date = new Date(isoString);
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: timezone
    });
  };

  const formatDuration = (durationStr) => {
    const match = durationStr.match(/0:(\d{2}):(\d{2})/);
    if (match) {
      return `${match[1]}m ${match[2]}s`;
    }
    return durationStr;
  };

  return (
    <Box sx={{ p: 1 }}>
      <Typography variant="subtitle2" sx={{ fontWeight: 'bold', mb: 1 }}>
        {pass.name} {isCurrent ? `(${t('timeline.active')})` : ''}
      </Typography>
      <Typography variant="body2">
        {t('timeline.start')}: {formatTime(pass.event_start)}
      </Typography>
      <Typography variant="body2">
        {t('timeline.end')}: {formatTime(pass.event_end)}
      </Typography>
      <Typography variant="body2">
        {t('timeline.duration')}: {formatDuration(pass.duration)}
      </Typography>
      <Typography variant="body2" sx={{ mt: 1 }}>
        {t('timeline.maxElevation')}: {pass.peak_altitude.toFixed(1)}°
      </Typography>
      <Typography variant="body2">
        {t('timeline.minDistance')}: {pass.distance_at_peak.toFixed(0)} km
      </Typography>
    </Box>
  );
};
