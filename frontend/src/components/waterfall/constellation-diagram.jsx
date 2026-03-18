import React, { useRef, useEffect, useCallback } from 'react';
import { useSelector } from 'react-redux';
import { Box, Typography, Chip } from '@mui/material';
import { useTheme } from '@mui/material/styles';

const CANVAS_SIZE = 200;
const PADDING = 20;
const PLOT_SIZE = CANVAS_SIZE - 2 * PADDING;

const ConstellationDiagram = () => {
    const theme = useTheme();
    const canvasRef = useRef(null);
    const { constellationPoints } = useSelector(state => state.bitlink21);

    const draw = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        const dpr = window.devicePixelRatio || 1;
        canvas.width = CANVAS_SIZE * dpr;
        canvas.height = CANVAS_SIZE * dpr;
        ctx.scale(dpr, dpr);

        // Background
        ctx.fillStyle = theme.palette.background.paper;
        ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

        const cx = CANVAS_SIZE / 2;
        const cy = CANVAS_SIZE / 2;
        const scale = PLOT_SIZE / 3; // ±1.5 range

        // Grid
        ctx.strokeStyle = theme.palette.divider;
        ctx.lineWidth = 0.5;

        // Axes
        ctx.beginPath();
        ctx.moveTo(PADDING, cy);
        ctx.lineTo(CANVAS_SIZE - PADDING, cy);
        ctx.moveTo(cx, PADDING);
        ctx.lineTo(cx, CANVAS_SIZE - PADDING);
        ctx.stroke();

        // Unit circle
        ctx.beginPath();
        ctx.arc(cx, cy, scale, 0, 2 * Math.PI);
        ctx.strokeStyle = theme.palette.divider;
        ctx.lineWidth = 0.3;
        ctx.stroke();

        // Labels
        ctx.fillStyle = theme.palette.text.secondary;
        ctx.font = '9px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('I', CANVAS_SIZE - PADDING + 8, cy + 3);
        ctx.fillText('Q', cx, PADDING - 5);

        // Constellation points
        if (constellationPoints && constellationPoints.length > 0) {
            ctx.fillStyle = '#f7931a'; // Bitcoin orange
            const pointSize = 2;

            for (const point of constellationPoints) {
                // Handle both {I, Q} objects and [re, im] arrays
                const re = point.I !== undefined ? point.I : (point[0] || 0);
                const im = point.Q !== undefined ? point.Q : (point[1] || 0);

                const x = cx + re * scale;
                const y = cy - im * scale; // Invert Y (canvas Y is down)

                ctx.beginPath();
                ctx.arc(x, y, pointSize, 0, 2 * Math.PI);
                ctx.fill();
            }
        }
    }, [constellationPoints, theme]);

    useEffect(() => {
        draw();
    }, [draw]);

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
                <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
                    Constellation
                </Typography>
                <Chip
                    label={`${constellationPoints?.length || 0} pts`}
                    size="small"
                    variant="outlined"
                    sx={{ ml: 'auto', height: 18, fontSize: '0.65rem' }}
                />
            </Box>
            <canvas
                ref={canvasRef}
                style={{
                    width: CANVAS_SIZE,
                    height: CANVAS_SIZE,
                    borderRadius: 4,
                    border: `1px solid ${theme.palette.divider}`,
                }}
            />
        </Box>
    );
};

export default ConstellationDiagram;
