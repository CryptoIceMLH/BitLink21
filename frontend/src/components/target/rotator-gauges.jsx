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

import * as React from "react";
import {
    GaugeContainer,
    GaugeValueArc,
    GaugeReferenceArc,
    useGaugeState,
    Gauge,
    gaugeClasses,
} from '@mui/x-charts/Gauge';

function GaugePointer() {
    const { valueAngle, outerRadius, cx, cy } = useGaugeState();

    if (valueAngle === null) {
        // No value to display
        return null;
    }

    const target = {
        x: cx + outerRadius * Math.sin(valueAngle),
        y: cy - outerRadius * Math.cos(valueAngle),
    };

    return (
        <g>
            {/* Define the filter for drop shadow */}
            <defs>
                <filter id="gauge-pointer-shadow" x="-50%" y="-50%" width="200%" height="200%">
                    <feDropShadow dx="2" dy="2" stdDeviation="2" floodOpacity="0.5" floodColor="rgba(0,0,0,0.5)" />
                </filter>
            </defs>

            {/* Apply the filter to both circle and path */}
            <circle
                cx={cx}
                cy={cy}
                r={5}
                fill="#f44336"
                filter="url(#gauge-pointer-shadow)"
            />
            <path
                d={`M ${cx} ${cy} L ${target.x} ${target.y}`}
                stroke="#f44336"
                strokeWidth={3}
                filter="url(#gauge-pointer-shadow)"
            />
        </g>
    );
}

const EdgeArrow = ({angle, stroke = "currentColor", strokeWidth = 1, opacity = 1, forElevation = false, arrowLength: lineLength = 0}) => {
    const {outerRadius, cx, cy} = useGaugeState();

    if (angle === null) {
        return;
    }

    const angleInRad = forElevation ?
        ((90 - angle) * Math.PI) / 180 :
        (angle * Math.PI) / 180;

    // Calculate point at the edge of the circle
    const edgePoint = {
        x: cx + outerRadius * Math.sin(angleInRad),
        y: cy - outerRadius * Math.cos(angleInRad),
    };

    // Calculate the inner point (inward from the edge)
    const innerPoint = {
        x: edgePoint.x - lineLength * Math.sin(angleInRad),
        y: edgePoint.y + lineLength * Math.cos(angleInRad),
    };

    // Calculate arrowhead points
    const arrowHeadSize = 10;
    // Angle for arrowhead lines (30 degrees from main line)
    const arrowAngle1 = angleInRad + Math.PI/6;
    const arrowAngle2 = angleInRad - Math.PI/6;

    const arrowHead1 = {
        x: edgePoint.x + arrowHeadSize * Math.sin(arrowAngle1),
        y: edgePoint.y - arrowHeadSize * Math.cos(arrowAngle1),
    };

    const arrowHead2 = {
        x: edgePoint.x + arrowHeadSize * Math.sin(arrowAngle2),
        y: edgePoint.y - arrowHeadSize * Math.cos(arrowAngle2),
    };

    // Create a path for the arrow (line with arrowhead)
    const arrowPath = `
        M ${innerPoint.x} ${innerPoint.y}
        L ${edgePoint.x} ${edgePoint.y}
        M ${edgePoint.x} ${edgePoint.y}
        L ${arrowHead1.x} ${arrowHead1.y}
        M ${edgePoint.x} ${edgePoint.y}
        L ${arrowHead2.x} ${arrowHead2.y}
    `;

    return (
        <g>
            <path
                d={arrowPath}
                stroke={stroke}
                strokeWidth={strokeWidth}
                opacity={opacity}
                fill="none"
            />
        </g>
    );
};

const Pointer = ({angle, stroke = "currentColor", strokeWidth = 1, opacity = 0.3, forElevation = false, dotted = false}) => {
    const {outerRadius, cx, cy} = useGaugeState();
    const angleInRad = forElevation ?
        ((90 - angle) * Math.PI) / 180 :
        (angle * Math.PI) / 180;
    const target = {
        x: cx + outerRadius * Math.sin(angleInRad),
        y: cy - outerRadius * Math.cos(angleInRad),
    };
    return (
        <g>
            <path
                d={`M ${cx} ${cy} L ${target.x} ${target.y}`}
                stroke={stroke}
                strokeWidth={strokeWidth}
                opacity={opacity}
                strokeDasharray={dotted ? "4,4" : "none"}
            />
        </g>
    );
};

const CircleSlice = ({
                         startAngle,
                         endAngle,
                         stroke = "currentColor",
                         fill = "currentColor",
                         strokeWidth = 1,
                         opacity = 0.2,
                         forElevation = false,
                         peakAz = null
                     }) => {
    const { outerRadius, cx, cy } = useGaugeState();

    // Convert startAngle and endAngle to radians
    const startAngleRad = (startAngle * Math.PI) / 180;
    const endAngleRad = (endAngle * Math.PI) / 180;

    // Calculate the start and end points on the circle
    const start = {
        x: cx + outerRadius * Math.sin(startAngleRad),
        y: cy - outerRadius * Math.cos(startAngleRad),
    };

    const end = {
        x: cx + outerRadius * Math.sin(endAngleRad),
        y: cy - outerRadius * Math.cos(endAngleRad),
    };

    function determineClockwiseDirection(arcArray) {
        if (arcArray.length > 0 && arcArray.length > 1) {
            if (arcArray[0] < arcArray[1]) {
                return 1;
            } else {
                return 0;
            }
        } else {
            return 1; // Default to clockwise
        }
    }

    function determineArcToDisplay(startAz, endAz, peakAz) {
        // Normalize angles to 0-360 range
        startAz = Math.round((startAz + 360) % 360);
        endAz = Math.round((endAz + 360) % 360);

        if (peakAz !== null) {
            peakAz = parseInt(peakAz + 360) % 360;

            // Create lists for the small arc and big arc degrees
            let smallArcDegrees = [];
            let bigArcDegrees = [];

            // Calculate the angle difference
            const angleDiff = (endAz - startAz + 360) % 360;

            // Determine which arc is the small one
            if (angleDiff <= 180) {
                // Small arc is clockwise from start to end
                let current = startAz;
                while (current !== endAz) {
                    smallArcDegrees.push(current);
                    current = (current + 1) % 360;
                }

                // Big arc is counter-clockwise from start to end
                current = startAz;
                while (current !== endAz) {
                    current = (current - 1 + 360) % 360;
                    bigArcDegrees.push(current);
                }
            } else {
                // Small arc is counter-clockwise from start to end
                let current = startAz;
                while (current !== endAz) {
                    current = (current - 1 + 360) % 360;
                    smallArcDegrees.push(current);
                }

                // Big arc is clockwise from start to end
                current = startAz;
                while (current !== endAz) {
                    current = (current + 1) % 360;
                    bigArcDegrees.push(current);
                }
            }

            // Check which arc contains the peak azimuth
            if (smallArcDegrees.includes(peakAz)) {
                // Get x-wise direction for arc
                const clockwiseDirection = determineClockwiseDirection(smallArcDegrees);

                // Use 0 for a small arc
                return [0, clockwiseDirection];

            } else if (bigArcDegrees.includes(peakAz)) {
                // Get x-wise direction for arc
                const clockwiseDirection = determineClockwiseDirection(bigArcDegrees);

                // Use 1 for a big arc
                return [1, clockwiseDirection];
            } else {
                // Default values if peak is not in either list
                return [angleDiff > 180 ? 1 : 0, 1];
            }
        }

        // Without peak azimuth, use standard arc determination
        const angleDiff = (endAz - startAz + 360) % 360;
        return [angleDiff > 180 ? 1 : 0, 1];
    }

    let largeArcFlag = 0;
    let sweepFlag = 1;

    if (!forElevation) {
        // Get arc flags for SVG path
        const result = determineArcToDisplay(startAngle, endAngle, peakAz);
        if (result && result.length === 2) {
            [largeArcFlag, sweepFlag] = result;
        }
    } else {
        largeArcFlag = 0;
        sweepFlag = 0;
    }

    // Create the SVG path for a slice
    // M: Move to center
    // L: Line to start point
    // A: Arc from start to end point
    // Z: Close path (line back to center)
    const pathData = `
        M ${cx} ${cy}
        L ${start.x} ${start.y}
        A ${outerRadius} ${outerRadius} 0 ${largeArcFlag} ${sweepFlag} ${end.x} ${end.y}
        Z
    `;

    return (
        <g>
            <path
                d={pathData}
                stroke={stroke}
                strokeWidth={strokeWidth}
                fill={fill}
                opacity={opacity}
            />
        </g>
    );
};

const rescaleToRange = (value, originalMin, originalMax, targetMin, targetMax) => {
    // Calculate what percentage the value is in its original range
    const percentage = (value - originalMin) / (originalMax - originalMin);

    // Map that percentage to the target range
    return targetMin + percentage * (targetMax - targetMin);
};

function GaugeAz({az, limits = [null, null],
                     peakAz = null, targetCurrentAz = null,
                     isGeoStationary = false, isGeoSynchronous = false,
                     hardwareLimits = [null, null]
}) {
    let [maxAz, minAz] = limits;
    let [hwMinAz, hwMaxAz] = hardwareLimits;

    return (
        <GaugeContainer
            style={{
                margin: 'auto',
                touchAction: 'auto',
                pointerEvents: 'none',
            }}
            valueMin={0}
            valueMax={360}
            width={140}
            height={140}
            startAngle={0}
            endAngle={360}
            value={az}
            onTouchStart={(e) => {
                // Stop event from bubbling up
                e.stopPropagation();
            }}
            onTouchMove={(e) => {
                // Stop event from bubbling up
                e.stopPropagation();
            }}
        >
            <GaugeReferenceArc/>
            <Pointer angle={270} dotted={true} stroke="#666" opacity={0.3}/>
            <Pointer angle={180} dotted={true} stroke="#666" opacity={0.3}/>
            <Pointer angle={90} dotted={true} stroke="#666" opacity={0.3}/>
            <Pointer angle={0} dotted={true} stroke="#666" opacity={0.3}/>
            {/* Pass limits - green allowed zone */}
            {minAz !== null && maxAz !== null && (!isGeoStationary && !isGeoSynchronous) && <>
                <Pointer angle={maxAz} stroke="#888" strokeWidth={1} opacity={0.3}/>
                <Pointer angle={minAz} stroke="#888" strokeWidth={1} opacity={0.3}/>
                <CircleSlice
                    startAngle={minAz}
                    endAngle={maxAz}
                    peakAz={peakAz}
                    stroke='#4caf50'
                    fill='#4caf50'
                    opacity={0.2}
                />
            </>}
            <text x="70" y="18" textAnchor="middle" dominantBaseline="middle" fontSize="12" fontWeight={"bold"}>0</text>
            <text x="124" y="70" textAnchor="middle" dominantBaseline="middle" fontSize="12" fontWeight={"bold"}>90</text>
            <text x="70" y="125" textAnchor="middle" dominantBaseline="middle" fontSize="12" fontWeight={"bold"}>180</text>
            <text x="15" y="70" textAnchor="middle" dominantBaseline="middle" fontSize="12" fontWeight={"bold"}>270</text>
            <EdgeArrow angle={targetCurrentAz} />
            <GaugePointer/>
            {/* Hardware limits - red restricted zones (rendered last to be on top) */}
            {hwMinAz !== null && hwMaxAz !== null && <>
                {/* Show red zone from 0 to hwMinAz if hwMinAz > 0 */}
                {hwMinAz > 0 && <CircleSlice
                    startAngle={0}
                    endAngle={hwMinAz}
                    stroke='#f44336'
                    fill='#f44336'
                    opacity={0.3}
                />}
                {/* Show red zone from hwMaxAz to 360 if hwMaxAz < 360 */}
                {hwMaxAz < 360 && <CircleSlice
                    startAngle={hwMaxAz}
                    endAngle={360}
                    stroke='#f44336'
                    fill='#f44336'
                    opacity={0.3}
                />}
            </>}
        </GaugeContainer>
    );
}

function GaugeEl({el, maxElevation = null, targetCurrentEl = null, hardwareLimits = [null, null]}) {
    const angle = rescaleToRange(maxElevation, 0, 90, 90, 0);
    let [hwMinEl, hwMaxEl] = hardwareLimits;

    const rescaleValue = (value) => {
        return 90 - value;
    };

    // Convert hardware limits to gauge angles (elevation gauge is inverted)
    const hwMinElAngle = hwMinEl !== null ? rescaleToRange(hwMinEl, 0, 90, 90, 0) : null;
    const hwMaxElAngle = hwMaxEl !== null ? rescaleToRange(hwMaxEl, 0, 90, 90, 0) : null;

    return (
        <GaugeContainer
            style={{
                margin: 'auto',
                touchAction: 'auto',
                pointerEvents: 'none',
            }}
            valueMin={90}
            valueMax={0}
            width={130}
            height={130}
            startAngle={0}
            endAngle={90}
            value={el}
            onTouchStart={(e) => {
                // Stop event from bubbling up
                e.stopPropagation();
            }}
            onTouchMove={(e) => {
                // Stop event from bubbling up
                e.stopPropagation();
            }}
        >
            <GaugeReferenceArc/>
            <Pointer angle={0} dotted={true} stroke="#666" opacity={0.3}/>
            {/* Pass limits - green allowed zone */}
            {maxElevation !== null && hwMinElAngle !== null && <>
                <Pointer angle={angle} stroke="#888" strokeWidth={1} opacity={0.3}/>
                <CircleSlice
                    startAngle={hwMinElAngle}
                    endAngle={angle}
                    stroke='#4caf50'
                    fill='#4caf50'
                    opacity={0.2}
                    forElevation={true}
                    spansNorth={false}
                />
            </>}
            <text x="107" y="120" textAnchor="middle" dominantBaseline="middle" fontSize="12" fontWeight={"bold"}>0</text>
            <text x="80" y="55" textAnchor="middle" dominantBaseline="middle" fontSize="12" fontWeight={"bold"}>45</text>
            <text x="10" y="23" textAnchor="middle" dominantBaseline="middle" fontSize="12" fontWeight={"bold"}>90</text>
            <EdgeArrow angle={rescaleValue(targetCurrentEl)} />
            <GaugePointer/>
            {/* Hardware limits - red restricted zones (rendered last to be on top) */}
            {hwMinElAngle !== null && hwMaxElAngle !== null && <>
                {/* Show red zone from gauge angle 90 (0° elevation) to hwMinElAngle */}
                <CircleSlice
                    startAngle={90}
                    endAngle={hwMinElAngle}
                    stroke='#f44336'
                    fill='#f44336'
                    forElevation={true}
                    opacity={0.3}
                />
                {/* Show red zone from hwMaxElAngle to 0 (90° elevation) if maxel < 90 */}
                {hwMaxEl < 90 && <CircleSlice
                    startAngle={hwMaxElAngle}
                    endAngle={0}
                    stroke='#f44336'
                    fill='#f44336'
                    forElevation={true}
                    opacity={0.3}
                />}
            </>}
        </GaugeContainer>
    );
}

export { GaugePointer, EdgeArrow, Pointer, CircleSlice, GaugeAz, GaugeEl, rescaleToRange };