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

/**
 * Get the current status of the rotator with color information
 * @param {Object} rotatorData - Rotator data from state
 * @param {string} lastRotatorEvent - Last rotator event from state
 * @returns {Object} Status object with key, value, bgColor, and fgColor
 */
export function getCurrentStatusofRotator(rotatorData, lastRotatorEvent) {
    // Define a status mapping with colors
    // Keys match the abbreviated event names from target-slice.jsx
    const statusMap = {
        'EL-MIN': {
            text: "Target below minimum elevation",
            bgColor: 'error.light',
            fgColor: 'error.dark'
        },
        'EL-MAX': {
            text: "Target above maximum elevation",
            bgColor: 'error.light',
            fgColor: 'error.dark'
        },
        'AZ-MIN': {
            text: "Target below minimum azimuth",
            bgColor: 'error.light',
            fgColor: 'error.dark'
        },
        'AZ-MAX': {
            text: "Target above maximum azimuth",
            bgColor: 'error.light',
            fgColor: 'error.dark'
        },
        'SLEW': {
            text: "Slewing",
            bgColor: 'warning.light',
            fgColor: 'warning.dark'
        },
        'TRK': {
            text: "Tracking",
            bgColor: 'success.light',
            fgColor: 'success.dark'
        },
        'STOP': {
            text: "Stopped",
            bgColor: 'info.light',
            fgColor: 'info.dark'
        },
        'OOB': {
            text: "Target below the horizon",
            bgColor: '#701c49',
            fgColor: '#f8440e'
        }
    };

    if (rotatorData['connected'] === true) {
        if (lastRotatorEvent) {
            // lastRotatorEvent is now a clean key (e.g., 'TRK', 'SLEW')
            // If the event exists in our map, use it, otherwise return "Idle"
            const status = statusMap[lastRotatorEvent] || {
                text: "Idle",
                bgColor: 'grey.200',
                fgColor: 'grey.800'
            };
            return {
                key: lastRotatorEvent,
                value: status.text,
                bgColor: status.bgColor,
                fgColor: status.fgColor
            };
        } else {
            return {
                key: 'unknown',
                value: "Unknown",
                bgColor: 'grey.200',
                fgColor: 'grey.800'
            };
        }
    } else {
        return {
            key: 'disconnected',
            value: "-",
            bgColor: 'grey.600',
            fgColor: 'grey.800'
        };
    }
}

/**
 * Get the connection status of the rotator
 * @param {Object} rotatorData - Rotator data from state
 * @returns {string} Connection status text
 */
export function getConnectionStatusofRotator(rotatorData) {
    if (rotatorData['connected'] === true) {
        return "Connected";
    } else if (rotatorData['connected'] === false) {
        return "Not connected";
    } else {
        return "unknown";
    }
}

/**
 * Create tracking state object for backend communication
 * @param {Object} params - Parameters for tracking state
 * @param {string} params.satelliteId - NORAD ID of satellite
 * @param {string} params.groupId - Group ID
 * @param {string} params.rotatorState - Rotator state
 * @param {string} params.rigState - Rig state
 * @param {string} params.selectedRadioRig - Selected radio rig ID
 * @param {string} params.selectedRotator - Selected rotator ID
 * @param {string} params.selectedTransmitter - Selected transmitter ID
 * @returns {Object} Tracking state object
 */
export function createTrackingState({
    satelliteId,
    groupId,
    rotatorState,
    rigState,
    selectedRadioRig,
    selectedRotator,
    selectedTransmitter
}) {
    return {
        'norad_id': satelliteId,
        'group_id': groupId,
        'rotator_state': rotatorState,
        'rig_state': rigState,
        'rig_id': selectedRadioRig,
        'rotator_id': selectedRotator,
        'transmitter_id': selectedTransmitter,
    };
}

/**
 * Check if rotator is in a connected state
 * @param {Object} trackingState - Current tracking state
 * @returns {boolean} True if rotator is connected
 */
export function isRotatorConnected(trackingState) {
    return !["disconnected"].includes(trackingState['rotator_state']);
}

/**
 * Check if rotator can be controlled (connected but not tracking)
 * @param {Object} rotatorData - Rotator data from state
 * @param {Object} trackingState - Current tracking state
 * @returns {boolean} True if rotator can be manually controlled
 */
export function canControlRotator(rotatorData, trackingState) {
    return rotatorData['connected'] && trackingState['rotator_state'] !== "tracking";
}

/**
 * Check if tracking can be started
 * @param {Object} trackingState - Current tracking state
 * @param {string} satelliteId - Selected satellite ID
 * @param {string} selectedRotator - Selected rotator ID
 * @returns {boolean} True if tracking can be started
 */
export function canStartTracking(trackingState, satelliteId, selectedRotator) {
    return !["tracking", "disconnected"].includes(trackingState['rotator_state']) &&
           satelliteId !== "" &&
           !["none", ""].includes(selectedRotator);
}

/**
 * Check if tracking can be stopped
 * @param {Object} trackingState - Current tracking state
 * @param {string} satelliteId - Selected satellite ID
 * @param {string} selectedRotator - Selected rotator ID
 * @returns {boolean} True if tracking can be stopped
 */
export function canStopTracking(trackingState, satelliteId, selectedRotator) {
    return !["stopped", "parked", "disconnected", "connected"].includes(trackingState['rotator_state']) &&
           satelliteId !== "" &&
           !["none", ""].includes(selectedRotator);
}

/**
 * Check if rotator can be connected
 * @param {Object} rotatorData - Rotator data from state
 * @param {string} selectedRotator - Selected rotator ID
 * @returns {boolean} True if rotator can be connected
 */
export function canConnectRotator(rotatorData, selectedRotator) {
    return !rotatorData['connected'] && !["none", ""].includes(selectedRotator);
}

/**
 * Check if rotator selection is disabled
 * @param {Object} trackingState - Current tracking state
 * @returns {boolean} True if rotator selection should be disabled
 */
export function isRotatorSelectionDisabled(trackingState) {
    return ["tracking", "connected", "stopped", "parked"].includes(trackingState['rotator_state']);
}