import { backendUpdateVFOParameters, setVFOProperty } from './vfo-slice.jsx';
import { flushAudioBuffers } from '../../dashboard/audio-service.js';
import { mapParametersToBackend } from './vfo-config.js';

// You might want to pass the socket as a parameter or get it differently
let socketInstance = null;

// Function to set socket (call this when socket is initialized)
export const setSocketForMiddleware = (socket) => {
    socketInstance = socket;
};

// Debounce delay for backend VFO parameter updates (milliseconds)
const BACKEND_UPDATE_DEBOUNCE_MS = 150;

// Debounce timers for each VFO (keyed by vfoNumber)
const debounceTimers = {};

// Debounced dispatcher for backend updates
const debouncedBackendUpdate = (store, vfoNumber, updateFn) => {
    // Clear existing timer for this VFO
    if (debounceTimers[vfoNumber]) {
        clearTimeout(debounceTimers[vfoNumber]);
    }

    // Set new timer
    debounceTimers[vfoNumber] = setTimeout(() => {
        updateFn();
        delete debounceTimers[vfoNumber];
    }, BACKEND_UPDATE_DEBOUNCE_MS);
};

// Helper function to filter out UI-only fields before sending to backend
const filterUIOnlyFields = (vfoState) => {
    // frequencyOffset is UI-only (used for doppler offset calculations)
    // lockedTransmitterId is now sent to backend as locked_transmitter_id
    // parameters is frontend-only (mapped to decoder-specific fields below)
    const { frequencyOffset, lockedTransmitterId, parameters, parametersEnabled, ...backendFields } = vfoState;

    // Convert camelCase to snake_case for backend
    // Only include locked_transmitter_id if it was present in the input (not undefined)
    // This prevents partial updates (like frequency-only) from overwriting the lock state
    // Send 'none' string as-is to backend
    if (lockedTransmitterId !== undefined) {
        backendFields.locked_transmitter_id = lockedTransmitterId;
    }

    // Send parametersEnabled to backend (defaults to true if not set)
    // Backend needs this to detect when user enables/disables custom parameters
    if (parametersEnabled !== undefined) {
        backendFields.parametersEnabled = parametersEnabled;
    }

    // Map decoder parameters from frontend format to backend format
    // Frontend: { parameters: { lora_sf: 7, lora_bw: 125000, ... } }
    // Backend: { sf: 7, bw: 125000, ... }
    // Only send parameters if parametersEnabled is true (defaults to true if not set)
    const paramsEnabled = parametersEnabled ?? true;
    if (paramsEnabled && parameters && vfoState.decoder && vfoState.decoder !== 'none') {
        const decoderParams = mapParametersToBackend(vfoState.decoder, parameters);
        Object.assign(backendFields, decoderParams);
    }

    return backendFields;
};

const backendSyncMiddleware = (store) => (next) => (action) => {
    // Get state BEFORE action is processed for VFO activation checks
    const stateBefore = store.getState();

    // Use the socket from the module variable instead of state
    const socket = socketInstance;

    if (!socket) {
        return next(action);
    }

    // Handle VFO activation - check BEFORE processing action
    if (action.type === 'vfo/setVfoActive') {
        const vfoNumber = action.payload;
        const vfoState = stateBefore.vfo.vfoMarkers[vfoNumber];

        // Check if VFO frequency is within current SDR bandwidth
        const centerFrequency = stateBefore.waterfall.centerFrequency;
        const sampleRate = stateBefore.waterfall.sampleRate;
        const vfoFrequency = vfoState.frequency;

        // Calculate SDR bandwidth limits
        const bandwidthStart = centerFrequency - (sampleRate / 2);
        const bandwidthEnd = centerFrequency + (sampleRate / 2);

        // Check if frequency is outside bandwidth or null
        const isOutsideBandwidth = vfoFrequency === null ||
                                   vfoFrequency < bandwidthStart ||
                                   vfoFrequency > bandwidthEnd;

        if (isOutsideBandwidth) {
            // VFO is outside bandwidth or uninitialized - reset to visible center and unlock
            // Use the visible center frequency if zoom/pan is active
            let targetFrequency = centerFrequency;
            if (typeof window !== 'undefined' && window.getWaterfallTransform) {
                const transform = window.getWaterfallTransform();
                targetFrequency = (transform.startFreq + transform.endFreq) / 2;
            }

            store.dispatch(setVFOProperty({
                vfoNumber: vfoNumber,
                updates: {
                    frequency: targetFrequency,
                    lockedTransmitterId: 'none',
                    frequencyOffset: 0
                }
            }));
        }
    }

    const result = next(action);
    const state = store.getState();

    if (!socket) {
        return result;
    }

    // Don't sync to backend if not streaming (except when starting streaming)
    const isStreaming = state.waterfall.isStreaming;
    if (!isStreaming && action.type !== 'waterfallState/setIsStreaming') {
        return result;
    }

    // Handle VFO property changes
    if (action.type === 'vfo/setVFOProperty') {
        const { vfoNumber, updates } = action.payload;

        // Handle frequencyOffset changes for locked VFOs
        const updateKeys = Object.keys(updates);
        const isOnlyOffsetChange = updateKeys.length === 1 && updateKeys[0] === 'frequencyOffset';

        if (isOnlyOffsetChange) {
            // Check if this VFO is locked to a transmitter
            const vfoState = state.vfo.vfoMarkers[vfoNumber];

            if (vfoState && vfoState.lockedTransmitterId && vfoState.lockedTransmitterId !== 'none') {
                // VFO is locked - immediately calculate and send new frequency with offset
                const transmitters = state.targetSatTrack.rigData.transmitters || [];
                const transmitter = transmitters.find(tx => tx.id === vfoState.lockedTransmitterId);

                if (transmitter && transmitter.downlink_observed_freq) {
                    const newOffset = updates.frequencyOffset;
                    const finalFrequency = transmitter.downlink_observed_freq + newOffset;

                    // Immediately dispatch frequency update to backend
                    store.dispatch(setVFOProperty({
                        vfoNumber: vfoNumber,
                        updates: { frequency: finalFrequency },
                    }));
                }
            }

            // Don't sync offset itself to backend - just update local state
            return result;
        }

        // Filter out UI-only fields before sending to backend
        const backendUpdates = filterUIOnlyFields(updates);

        // Dispatch async thunk to update backend with complete state (debounced)
        // Re-read state at fire time to avoid sending stale active/selected values.
        debouncedBackendUpdate(store, vfoNumber, () => {
            const currentState = store.getState();
            const currentVfoState = currentState.vfo.vfoMarkers[vfoNumber];
            if (!currentVfoState) {
                return;
            }
            const currentVfoActiveState = currentState.vfo.vfoActive[vfoNumber];
            const currentIsSelected = currentState.vfo.selectedVFO === vfoNumber;
            const backendVfoState = filterUIOnlyFields(currentVfoState);

            store.dispatch(backendUpdateVFOParameters({
                socket,
                vfoNumber,
                updates: {
                    vfoNumber: vfoNumber,
                    ...backendVfoState,
                    ...backendUpdates,
                    active: currentVfoActiveState,
                    selected: currentIsSelected,
                },
            }));
        });
    }

    // Handle selected VFO changes
    if (action.type === 'vfo/setSelectedVFO') {
        const selectedVFO = action.payload;

        if (selectedVFO === null) {
            // Deselect all VFOs - vfoNumber: 0 is special case for backend
            store.dispatch(backendUpdateVFOParameters({
                socket,
                vfoNumber: 0,
                updates: { 
                    vfoNumber: 0,
                    selected: false 
                }
            }));
        } else {
            // Send complete VFO state when selecting to ensure backend has all parameters
            const vfoState = state.vfo.vfoMarkers[selectedVFO];
            const vfoActiveState = state.vfo.vfoActive[selectedVFO];
            const backendVfoState = filterUIOnlyFields(vfoState);
            
            store.dispatch(backendUpdateVFOParameters({
                socket,
                vfoNumber: selectedVFO,
                updates: {
                    vfoNumber: selectedVFO,
                    ...backendVfoState,
                    active: vfoActiveState,
                    selected: true
                }
            }));
        }
    }

    // Handle VFO activation - send state to backend
    if (action.type === 'vfo/setVfoActive') {
        const vfoNumber = action.payload;
        const vfoState = state.vfo.vfoMarkers[vfoNumber];
        const isSelected = state.vfo.selectedVFO === vfoNumber;

        // Filter out UI-only fields before sending to backend
        const backendVfoState = filterUIOnlyFields(vfoState);

        // Send complete VFO state when activating to ensure backend has all parameters
        store.dispatch(backendUpdateVFOParameters({
            socket,
            vfoNumber,
            updates: {
                vfoNumber: vfoNumber,
                ...backendVfoState,
                active: true,
                selected: isSelected,
            }
        }));
    }

    // Handle VFO deactivation
    if (action.type === 'vfo/setVfoInactive') {
        const vfoNumber = action.payload;

        // Clear lock state when deactivating to prevent stale state issues
        // This ensures clean activation later without triggering unnecessary decoder restarts
        store.dispatch(setVFOProperty({
            vfoNumber: vfoNumber,
            updates: {
                lockedTransmitterId: 'none',
                frequencyOffset: 0
            }
        }));

        // Send complete VFO state when deactivating to ensure backend has all parameters
        store.dispatch(backendUpdateVFOParameters({
            socket,
            vfoNumber,
            updates: {
                active: false,
                locked_transmitter_id: 'none'
            }
        }));
    }

    // Handle streaming start - send all VFO data to backend
    if (action.type === 'waterfallState/setIsStreaming' && action.payload === true) {
        const vfoMarkers = state.vfo.vfoMarkers;
        const vfoActive = state.vfo.vfoActive;
        const selectedVFO = state.vfo.selectedVFO;

        // Send each VFO's complete state to the backend
        Object.keys(vfoMarkers).forEach(vfoNumber => {
            const vfoNum = parseInt(vfoNumber);
            const vfoState = vfoMarkers[vfoNum];
            const isActive = vfoActive[vfoNum];
            const isSelected = selectedVFO === vfoNum;

            // Only send VFO data if the VFO has been initialized (frequency is not null)
            // and the VFO is active
            if (vfoState.frequency !== null && isActive) {
                // Filter out UI-only fields before sending to backend
                const backendVfoState = filterUIOnlyFields(vfoState);

                store.dispatch(backendUpdateVFOParameters({
                    socket,
                    vfoNumber: vfoNum,
                    updates: {
                        vfoNumber: vfoNum,
                        ...backendVfoState,
                        active: isActive,
                        selected: isSelected,
                    },
                }));
            }
        });
    }

    // Handle satellite tracking data updates - track doppler-corrected frequencies for locked VFOs
    if (action.type === 'targetSatTrack/setSatelliteData') {
        const rigData = action.payload?.rig_data;
        const satelliteData = action.payload?.satellite_data;

        // OPTION 1: Detect satellite changes and unlock all VFOs
        // When the target satellite changes, all locked VFOs should be unlocked because:
        // 1. The transmitter IDs from the old satellite won't exist in the new satellite's transmitter list
        // 2. Keeping VFOs locked to non-existent transmitters would cause them to stop tracking
        // 3. Users need to manually re-lock VFOs to transmitters of the new satellite
        if (satelliteData && satelliteData.details) {
            const currentNoradId = satelliteData.details.norad_id;
            const previousNoradId = state.targetSatTrack.satelliteData.details.norad_id;

            // Check if the satellite has changed (different NORAD ID)
            if (currentNoradId && previousNoradId && currentNoradId !== previousNoradId) {
                const vfoMarkers = state.vfo.vfoMarkers;

                console.log(`Satellite changed from ${previousNoradId} to ${currentNoradId} - unlocking all VFOs`);

                // Unlock all VFOs that are currently locked to transmitters
                Object.keys(vfoMarkers).forEach(vfoNumber => {
                    const vfoNum = parseInt(vfoNumber);
                    const vfo = vfoMarkers[vfoNum];

                    if (vfo.lockedTransmitterId && vfo.lockedTransmitterId !== 'none') {
                        store.dispatch(setVFOProperty({
                            vfoNumber: vfoNum,
                            updates: {
                                lockedTransmitterId: 'none',
                                frequencyOffset: 0
                            },
                        }));

                        console.log(`VFO ${vfoNum} unlocked due to satellite change`);
                    }
                });

                // Early return - don't process frequency tracking for the old satellite's transmitters
                return result;
            }
        }

        if (rigData && rigData.transmitters && rigData.transmitters.length > 0) {
            const vfoMarkers = state.vfo.vfoMarkers;

            // Check each VFO to see if it's locked to a transmitter
            Object.keys(vfoMarkers).forEach(vfoNumber => {
                const vfoNum = parseInt(vfoNumber);
                const vfo = vfoMarkers[vfoNum];

                // Only update if VFO is locked to a transmitter
                if (vfo.lockedTransmitterId && vfo.lockedTransmitterId !== 'none') {
                    // Find the transmitter this VFO is locked to
                    const transmitter = rigData.transmitters.find(tx => tx.id === vfo.lockedTransmitterId);

                    // This handles edge cases where transmitter data becomes unavailable for reasons other
                    // than satellite changes (e.g., transmitter disabled, data corruption, etc.)
                    if (!transmitter) {
                        store.dispatch(setVFOProperty({
                            vfoNumber: vfoNum,
                            updates: {
                                lockedTransmitterId: 'none',
                                frequencyOffset: 0
                            },
                        }));

                        console.warn(`VFO ${vfoNum} unlocked: transmitter ID ${vfo.lockedTransmitterId} not found in current transmitter list`);
                        return;  // Skip frequency update for this VFO
                    }

                    if (transmitter.downlink_observed_freq) {
                        // Apply frequency offset (can be positive or negative)
                        const offset = vfo.frequencyOffset || 0;
                        const finalFrequency = transmitter.downlink_observed_freq + offset;

                        // Check if frequency has changed (to avoid unnecessary updates)
                        if (vfo.frequency !== finalFrequency) {
                            // Only update frequency for active VFOs
                            // Inactive VFOs don't need backend updates since they're not demodulating
                            const isVfoActive = state.vfo.vfoActive[vfoNum];

                            if (isVfoActive) {
                                store.dispatch(setVFOProperty({
                                    vfoNumber: vfoNum,
                                    updates: { frequency: finalFrequency },
                                }));
                            }

                            const offsetStr = offset !== 0 ? ` (offset: ${offset >= 0 ? '+' : ''}${(offset / 1e3).toFixed(1)} kHz)` : '';
                        }
                    }
                }
            });
        }
    }

    return result;
};

export default backendSyncMiddleware;
