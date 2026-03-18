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


import { createSlice } from '@reduxjs/toolkit';
import {createAsyncThunk} from '@reduxjs/toolkit';
import {calculateElevationCurvesForPasses} from '../../utils/elevation-curve-calculator.js';

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

const normalizeTransmitters = (transmitters = []) =>
    transmitters.map((tx) => ({
        ...tx,
        source: normalizeSource(tx.source),
    }));

const normalizeGroupOfSats = (sats = []) =>
    sats.map((sat) => {
        if (!Array.isArray(sat.transmitters)) {
            return sat;
        }
        return {
            ...sat,
            transmitters: normalizeTransmitters(sat.transmitters),
        };
    });

const transmitterIdentity = (tx = {}) =>
    String(
        tx.id
        ?? `${tx.description ?? ''}:${tx.downlink_low ?? ''}:${tx.uplink_low ?? ''}:${tx.mode ?? ''}`
    );

const sameTransmitterSet = (left = [], right = []) => {
    if (left.length !== right.length) {
        return false;
    }
    const leftIds = left.map(transmitterIdentity).sort();
    const rightIds = right.map(transmitterIdentity).sort();
    for (let i = 0; i < leftIds.length; i += 1) {
        if (leftIds[i] !== rightIds[i]) {
            return false;
        }
    }
    return true;
};


export const sendNudgeCommand = createAsyncThunk(
    'targetSatTrack/sendNudgeCommand',
    async ({socket, cmd}, {rejectWithValue}) => {
        return new Promise((resolve, reject) => {
            socket.emit('data_submission', 'nudge-rotator', cmd, (response) => {
                if (response.success) {
                    resolve(response.data);
                } else {
                    reject(rejectWithValue("Failed to send nudge command"));
                }
            });
        });
    }
);


export const setTargetMapSetting = createAsyncThunk(
    'targetSatTrack/setTargetMapSetting',
    async ({socket, key}, {getState, rejectWithValue}) => {
        const state = getState();
        const mapSettings = {
            showPastOrbitPath: state['targetSatTrack']['showPastOrbitPath'],
            showFutureOrbitPath: state['targetSatTrack']['showFutureOrbitPath'],
            showSatelliteCoverage: state['targetSatTrack']['showSatelliteCoverage'],
            showSunIcon: state['targetSatTrack']['showSunIcon'],
            showMoonIcon: state['targetSatTrack']['showMoonIcon'],
            showTerminatorLine: state['targetSatTrack']['showTerminatorLine'],
            showTooltip: state['targetSatTrack']['showTooltip'],
            showGrid: state['targetSatTrack']['showGrid'],
            pastOrbitLineColor: state['targetSatTrack']['pastOrbitLineColor'],
            futureOrbitLineColor: state['targetSatTrack']['futureOrbitLineColor'],
            satelliteCoverageColor: state['targetSatTrack']['satelliteCoverageColor'],
            orbitProjectionDuration: state['targetSatTrack']['orbitProjectionDuration'],
            tileLayerID: state['targetSatTrack']['tileLayerID'],
        };

        return await new Promise((resolve, reject) => {
            socket.emit('data_submission', 'set-map-settings', {name: key, value: mapSettings}, (response) => {
                if (response.success) {
                    resolve(response.data);
                } else {
                    reject(rejectWithValue('Failed to set the mapping settings in the backend'));
                }
            });
        });
    }
);


export const getTargetMapSettings = createAsyncThunk(
    'targetSatTrack/getTargetMapSettings',
    async ({socket}, {rejectWithValue}) => {
        return new Promise((resolve, reject) => {
            socket.emit('data_request', 'get-map-settings', 'target-map-settings', (response) => {
                if (response.success) {
                    resolve(response.data['value']);
                } else {
                    reject(rejectWithValue("Failed getting the target map settings from backend"));
                }
            });
        });
    }
);


export const getTrackingStateFromBackend = createAsyncThunk(
    'targetSatTrack/getTrackingStateBackend',
    async ({socket}, {rejectWithValue}) => {
        return new Promise((resolve, reject) => {
            socket.emit('data_request', 'get-tracking-state', null, (response) => {
                if (response.success) {
                    resolve(response.data);
                } else {
                    reject(rejectWithValue("Failed getting tracking state from backend"));
                }
            });
        });
    }
);


export const setTrackingStateInBackend = createAsyncThunk(
    'targetSatTrack/setTrackingStateBackend',
    async ({socket, data}, {getState, dispatch, rejectWithValue}) => {
        const state = getState();
        const {norad_id, rotator_state, rig_state, group_id, rig_id, rotator_id, transmitter_id, rig_vfo, vfo1, vfo2} = data;
        const trackState = {
            'name': 'satellite-tracking',
            'value': {
                'norad_id': norad_id,
                'rotator_state': rotator_state,
                'rig_state': rig_state,
                'group_id': group_id,
                'rotator_id': rotator_id,
                'rig_id': rig_id,
                'transmitter_id': transmitter_id,
                'rig_vfo': rig_vfo,
                'vfo1': vfo1,
                'vfo2': vfo2,
            }
        };
        return new Promise((resolve, reject) => {
            socket.emit('data_submission', 'set-tracking-state', trackState, (response) => {
                if (response.success) {
                    resolve(response.data);
                } else {
                    reject(rejectWithValue(response));
                }
            });
        });
    }
);


export const fetchNextPasses = createAsyncThunk(
    'targetSatTrack/fetchNextPasses',
    async ({socket, noradId, hours, forceRecalculate = false}, {getState, rejectWithValue}) => {
        return new Promise((resolve, reject) => {
            socket.emit('data_request', 'fetch-next-passes', {
                'norad_id': noradId,
                'hours': hours,
                'force_recalculate': forceRecalculate
            }, (response) => {
                if (response.success) {
                    resolve(response.data);
                } else {
                    reject(rejectWithValue("Failed getting next passes"));
                }
            });
        });
    }
);


export const fetchSatelliteGroups = createAsyncThunk(
    'targetSatTrack/fetchSatelliteGroups',
    async ({ socket }, { rejectWithValue }) => {
        return new Promise((resolve, reject) => {
            socket.emit('data_request', 'get-satellite-groups', null, (response) => {
                if (response.success) {
                    resolve(response.data);
                } else {
                    reject(rejectWithValue(response.message));
                }
            });
        });
    }
);


export const fetchSatellitesByGroupId = createAsyncThunk(
    'targetSatTrack/fetchSatellitesByGroupId',
    async ({ socket, groupId }, { rejectWithValue }) => {
        return new Promise((resolve, reject) => {
                socket.emit('data_request', 'get-satellites-for-group-id', groupId, (response) => {
                if (response.success) {
                    const satellites = response.data;
                    resolve({ satellites });
                } else {
                    reject(rejectWithValue(response.message));
                }
            });
        });
    }
);


export const fetchSatellite = createAsyncThunk(
    'satellites/fetchSatellite',
    async ({ socket, noradId }, { rejectWithValue }) => {
        try {
            return await new Promise((resolve, reject) => {
                socket.emit('data_request', 'get-satellite', noradId, (response) => {
                    if (response.success) {
                        resolve(response.data);
                    } else {
                        reject(new Error('Failed to fetch satellites'));
                    }
                });
            });
        } catch (error) {
            return rejectWithValue(error.message);
        }
    }
);


const targetSatTrackSlice = createSlice({
    name: 'targetSatTrack',
    initialState: {
        rotatorConnecting: false,
        rotatorDisconnecting: false,
        groupId: "",
        satelliteId: "",
        satGroups: [],
        groupOfSats: [],
        trackingState: {
            'norad_id': '',
            'rotator_state': 'disconnected',
            'rig_state': 'disconnected',
            'group_id': '',
            'rig_id': 'none',
            'rotator_id': 'none',
            'transmitter_id': 'none'
        },
        satelliteData: {
            position: {
                lat: 0,
                lng: 0,
                alt: 0,
                vel: 0,
                az: 0,
                el: 0,
            },
            paths: {
                'past': [],
                'future': []
            },
            coverage: [],
            details: {
                name: '',
                norad_id: '',
                name_other: '',
                alternative_name: '',
                operator: '',
                countries: '',
                tle1: "",
                tle2: "",
                launched: null,
                deployed: null,
                decayed: null,
                updated: null,
                status: '',
                website: '',
                is_geostationary: false,
            },
            transmitters: [],
        },
        satellitePasses: [],
        activePass: {},
        passesLoading: false,
        passesError: null,
        loading: false,
        error: null,
        showPastOrbitPath: true,
        showFutureOrbitPath: true,
        showSatelliteCoverage: true,
        showSunIcon: true,
        showMoonIcon: true,
        showTerminatorLine: true,
        showTooltip: true,
        showGrid: true,
        currentSatellitesPosition: [],
        currentSatellitesCoverage: [],
        terminatorLine: [],
        daySidePolygon: [],
        pastOrbitLineColor: '#33c833',
        futureOrbitLineColor: '#e4971e',
        satelliteCoverageColor: '#112eed',
        orbitProjectionDuration: 60*24,
        tileLayerID: 'satellite',
        mapZoomLevel: 2,
        sunPos: null,
        moonPos: null,
        gridEditable: false,
        sliderTimeOffset: 0,
        satelliteSelectOpen: false,
        satelliteGroupSelectOpen: false,
        uiTrackerDisabled: false,
        starting: true,
        selectedRadioRig: "",
        selectedRotator: "",
        selectedRigVFO: "none",
        selectedVFO1: "uplink",
        selectedVFO2: "downlink",
        openMapSettingsDialog: false,
        openPassesTableSettingsDialog: false,
        passesTableColumnVisibility: {
            event_start: true,
            event_end: true,
            duration: true,
            progress: true,
            distance_at_start: false,
            distance_at_end: false,
            distance_at_peak: false,
            peak_altitude: true,
            is_geostationary: false,
            is_geosynchronous: false,
        },
        passesTablePageSize: 15,
        nextPassesHours: 24.0,
        cachedPasses: {},
        selectedTransmitter: "none",
        availableTransmitters: [],
        transmitterSyncLock: {
            noradId: null,
            expiresAtMs: 0,
        },
        rotatorData: {
            'az': 0,
            'el': 0,
            'slewing': false,
            'connected': false,
            'tracking': false,
            'minelevation': false,
            'maxelevation': false,
            'minazimuth': false,
            'maxazimuth': false,
            'outofbounds': false,
        },
        lastRotatorEvent: "",
        rigData: {
            'connected': false,
            'doppler_shift': 0,
            'frequency': 0,
            'downlink_observed_freq': 0,
            'tracking': false,
            'transmitters': [],
        },
        colorMaps: [
            'viridis',
            'plasma',
            'inferno',
            'magma',
            'jet',
            'websdr',
            'cosmic',
        ],
        colorMap: 'cosmic',
        dbRange: [-19, 0],
        fftSizeOptions: [256, 512, 1024, 2048, 4096],
        fftSize: 1024,
        gain: 20,
        sampleRate: 2048000,
        centerFrequency: 100000000,
        errorMessage: null,
        isStreaming: false,
        isPlaying: false,
        targetFPS: 30,
        settingsDialogOpen: false,
        autoDBRange: false,
    },
    reducers: {
        setLoading(state, action) {
            state.loading = action.payload;
        },
        setSatelliteData(state, action) {
            if (action.payload['tracking_state']) {
                state.trackingState = action.payload['tracking_state'];
            }

            if (action.payload['satellite_data']) {
                state.satelliteData.details = action.payload['satellite_data']['details'];
                state.satelliteData.position = action.payload['satellite_data']['position'];
                state.satelliteData.paths = action.payload['satellite_data']['paths'];
                state.satelliteData.coverage = action.payload['satellite_data']['coverage'];
                const incomingTransmitters = normalizeTransmitters(
                    action.payload['satellite_data']['transmitters']
                );
                const incomingNoradId = action.payload['satellite_data']?.details?.norad_id;
                const lockMatchesSatellite = (
                    state.transmitterSyncLock?.noradId != null
                    && String(state.transmitterSyncLock.noradId) === String(incomingNoradId)
                );
                const lockActive = lockMatchesSatellite
                    && Number(state.transmitterSyncLock.expiresAtMs || 0) > Date.now();

                if (!lockActive) {
                    state.satelliteData.transmitters = incomingTransmitters;
                    if (lockMatchesSatellite) {
                        state.transmitterSyncLock = { noradId: null, expiresAtMs: 0 };
                    }
                } else if (
                    sameTransmitterSet(incomingTransmitters, state.satelliteData.transmitters || [])
                ) {
                    // Backend caught up with the latest manual edits; unlock and accept updates.
                    state.satelliteData.transmitters = incomingTransmitters;
                    state.transmitterSyncLock = { noradId: null, expiresAtMs: 0 };
                }
                state.satelliteData.nextPass = action.payload['satellite_data']['nextPass'];
            }

            // Detect state change for the rotator and do stuff there
            if (action.payload['rotator_data']) {
                // Update the whole rotatorData object
                state.rotatorData = action.payload['rotator_data'];

                if (state.rotatorData['connected'] === true) {
                    if (action.payload['rotator_data']['connected'] === false) {
                        state.rotatorDisconnecting = false;
                    }

                } else if (state.rotatorData['connected'] === false) {
                    if (action.payload['rotator_data']['connected'] === true) {
                        state.rotatorConnecting = false;
                    }
                }

                // In case of error connecting or disconnecting, reset ui flags
                if (state.rotatorData['error']) {
                    state.rotatorConnecting = false;
                    state.rotatorDisconnecting = false;
                }

                // Update rotator events - check specific limit flags first
                // Store clean event keys (display formatting happens in components)
                if (action.payload['rotator_data']['minelevation']) {
                    state.lastRotatorEvent = 'EL-MIN';
                } else if (action.payload['rotator_data']['maxelevation']) {
                    state.lastRotatorEvent = 'EL-MAX';
                } else if (action.payload['rotator_data']['minazimuth']) {
                    state.lastRotatorEvent = 'AZ-MIN';
                } else if (action.payload['rotator_data']['maxazimuth']) {
                    state.lastRotatorEvent = 'AZ-MAX';
                } else if (action.payload['rotator_data']['outofbounds']) {
                    state.lastRotatorEvent = 'OOB';
                } else if (action.payload['rotator_data']['slewing']) {
                    state.lastRotatorEvent = 'SLEW';
                } else if (action.payload['rotator_data']['tracking']) {
                    state.lastRotatorEvent = 'TRK';
                } else if (action.payload['rotator_data']['stopped']) {
                    state.lastRotatorEvent = 'STOP';
                }
            }

            // Update the whole rig_data object
            if (action.payload['rig_data']) {
                state.rigData = action.payload['rig_data'];
                if (Array.isArray(state.rigData?.transmitters)) {
                    state.rigData.transmitters = normalizeTransmitters(state.rigData.transmitters);
                }
            }
        },
        setUITrackerValues(state, action) {
            state.satGroups = action.payload['groups'];
            state.groupOfSats = normalizeGroupOfSats(action.payload['satellites']);
            state.availableTransmitters = normalizeTransmitters(action.payload['transmitters']);
            state.satelliteId = action.payload['norad_id'];
            state.groupId = action.payload['group_id'];
            state.selectedRadioRig = action.payload['rig_id'];
            state.selectedRotator = action.payload['rotator_id'];
            state.selectedTransmitter = action.payload['transmitter_id'];
            // Don't sync selectedRigVFO from backend - it's session-specific
        },
        setSatellitePasses(state, action) {
            state.satellitePasses = action.payload;
        },
        updateSatellitePassesWithElevationCurves(state, action) {
            // Update satellite passes with calculated elevation curves
            state.satellitePasses = action.payload;
        },
        setSatGroupId(state, action) {
            state.groupId = action.payload;
        },
        setSatelliteId(state, action) {
            state.satelliteId = action.payload;
        },
        setShowPastOrbitPath(state, action) {
            state.showPastOrbitPath = action.payload;
        },
        setShowFutureOrbitPath(state, action) {
            state.showFutureOrbitPath = action.payload;
        },
        setShowSatelliteCoverage(state, action) {
            state.showSatelliteCoverage = action.payload;
        },
        setShowSunIcon(state, action) {
            state.showSunIcon = action.payload;
        },
        setShowMoonIcon(state, action) {
            state.showMoonIcon = action.payload;
        },
        setShowTerminatorLine(state, action) {
            state.showTerminatorLine = action.payload;
        },
        setShowTooltip(state, action) {
            state.showTooltip = action.payload;
        },
        setTerminatorLine(state, action) {
            state.terminatorLine = action.payload;
        },
        setDaySidePolygon(state, action) {
            state.daySidePolygon = action.payload;
        },
        setPastOrbitLineColor(state, action) {
            state.pastOrbitLineColor = action.payload;
        },
        setFutureOrbitLineColor(state, action) {
            state.futureOrbitLineColor = action.payload;
        },
        setSatelliteCoverageColor(state, action) {
            state.satelliteCoverageColor = action.payload;
        },
        setOrbitProjectionDuration(state, action) {
            state.orbitProjectionDuration = action.payload;
        },
        setTileLayerID(state, action) {
            state.tileLayerID = action.payload;
        },
        setMapZoomLevel(state, action) {
            state.mapZoomLevel = action.payload;
        },
        setSunPos(state, action) {
            state.sunPos = action.payload;
        },
        setMoonPos(state, action) {
            state.moonPos = action.payload;
        },
        setGridEditable(state, action) {
            state.gridEditable = action.payload;
        },
        setSliderTimeOffset(state, action) {
            state.sliderTimeOffset = action.payload;
        },
        setLocation(state, action) {
            state.location = action.payload;
        },
        setSatelliteSelectOpen(state, action) {
            state.satelliteSelectOpen = action.payload;
        },
        setSatelliteGroupSelectOpen(state, action) {
            state.satelliteGroupSelectOpen = action.payload;
        },
        setGroupOfSats(state, action) {
            state.groupOfSats = normalizeGroupOfSats(action.payload);
        },
        setUITrackerDisabled(state, action) {
            state.uiTrackerDisabled = action.payload;
        },
        setStarting(state, action) {
            state.c = action.payload;
        },
        setRadioRig(state, action) {
            state.selectedRadioRig = action.payload;
        },
        setRotator(state, action) {
            state.selectedRotator = action.payload;
        },
        setRigVFO(state, action) {
            state.selectedRigVFO = action.payload;
        },
        setVFO1(state, action) {
            state.selectedVFO1 = action.payload;
        },
        setVFO2(state, action) {
            state.selectedVFO2 = action.payload;
        },
        setOpenMapSettingsDialog(state, action) {
            state.openMapSettingsDialog = action.payload;
        },
        setOpenPassesTableSettingsDialog(state, action) {
            state.openPassesTableSettingsDialog = action.payload;
        },
        setPassesTableColumnVisibility(state, action) {
            state.passesTableColumnVisibility = action.payload;
        },
        setPassesTablePageSize(state, action) {
            state.passesTablePageSize = action.payload;
        },
        setNextPassesHours(state, action) {
            state.nextPassesHours = action.payload;
        },
        setSelectedTransmitter(state, action) {
            state.selectedTransmitter = action.payload;
        },
        setAvailableTransmitters(state, action) {
            state.availableTransmitters = normalizeTransmitters(action.payload);
        },
        setTargetTransmitters(state, action) {
            const noradId = action.payload?.noradId;
            const transmitters = normalizeTransmitters(action.payload?.transmitters || []);
            const lockDurationMs = Number(action.payload?.lockDurationMs ?? 5000);
            const updatedAtMs = Number(action.payload?.updatedAtMs ?? Date.now());
            if (
                state.satelliteData?.details?.norad_id != null
                && String(state.satelliteData.details.norad_id) === String(noradId)
            ) {
                state.satelliteData.transmitters = transmitters;
            }
            if (state.satelliteId != null && String(state.satelliteId) === String(noradId)) {
                state.availableTransmitters = transmitters;
            }
            state.transmitterSyncLock = {
                noradId: noradId ?? null,
                expiresAtMs: updatedAtMs + Math.max(lockDurationMs, 0),
            };
        },
        setShowGrid(state, action) {
            state.showGrid = action.payload;
        },
        setRotatorData(state, action) {
            state.rotatorData = action.payload;
        },
        setColorMap: (state, action) => {
            state.colorMap = action.payload;
        },
        setColorMaps: (state, action) => {
            state.colorMaps = action.payload;
        },
        setDbRange: (state, action) => {
            state.dbRange = action.payload;
        },
        setFFTSize: (state, action) => {
            state.fftSize = action.payload;
        },
        setFFTSizeOptions: (state, action) => {
            state.fftSizeOptions = action.payload;
        },
        setGain: (state, action) => {
            state.gain = action.payload;
        },
        setSampleRate: (state, action) => {
            state.sampleRate = action.payload;
        },
        setCenterFrequency: (state, action) => {
            state.centerFrequency = action.payload;
        },
        setErrorMessage: (state, action) => {
            state.errorMessage = action.payload;
        },
        setIsStreaming: (state, action) => {
            state.isStreaming = action.payload;
        },
        setTargetFPS: (state, action) => {
            state.targetFPS = action.payload;
        },
        setIsPlaying: (state, action) => {
            state.isPlaying = action.payload;
        },
        setSettingsDialogOpen: (state, action) => {
            state.settingsDialogOpen = action.payload;
        },
        setAutoDBRange: (state, action) => {
            state.autoDBRange = action.payload;
        },
        setLastRotatorEvent: (state, action) => {
            state.lastRotatorEvent = action.payload;
        },
        setActivePass: (state, action) => {
            state.activePass = action.payload;
        },
        setRotatorConnecting: (state, action) => {
            state.rotatorConnecting = action.payload;
        },
        setRotatorDisconnecting: (state, action) => {
            state.rotatorDisconnecting = action.payload;
        }
    },
    extraReducers: (builder) => {
        builder
            .addCase(setTrackingStateInBackend.pending, (state) => {
                state.loading = true;
                state.error = null;
            })
            .addCase(setTrackingStateInBackend.fulfilled, (state, action) => {
                state.loading = false;
                state.trackingState = action.payload;
                state.error = null;
            })
            .addCase(setTrackingStateInBackend.rejected, (state, action) => {
                state.loading = false;
                state.error = action.payload;
            })
            .addCase(fetchNextPasses.pending, (state) => {
                state.passesLoading = true;
                state.passesError = null;
            })
            .addCase(fetchNextPasses.fulfilled, (state, action) => {
                state.passesLoading = false;
                // Store passes with empty elevation curves initially (they'll be calculated in the background)
                state.satellitePasses = action.payload.map(pass => ({
                    ...pass,
                    elevation_curve: pass.elevation_curve || [] // Ensure elevation_curve exists but may be empty
                }));

                // Find the current pass and mark it
                const now = new Date().getTime();
                const activePass = action.payload.find(pass => {
                    const startTime = new Date(pass['event_start']).getTime();
                    const endTime = new Date(pass['event_end']).getTime();
                    return now >= startTime && now <= endTime;
                });

                state.activePass = activePass;
                state.passesError = null;
            })
            .addCase(fetchNextPasses.rejected, (state, action) => {
                state.passesLoading = false;
                state.passesError = action.payload;
            })
            .addCase(fetchSatelliteGroups.pending, (state) => {
                state.loading = true;
                state.error = null;
            })
            .addCase(fetchSatelliteGroups.fulfilled, (state, action) => {
                state.loading = false;
                state.satGroups = action.payload;
            })
            .addCase(fetchSatelliteGroups.rejected, (state, action) => {
                state.loading = false;
                state.error = action.payload;
            })
            .addCase(fetchSatellitesByGroupId.pending, (state) => {
                state.loading = true;
                state.error = null;
            })
            .addCase(fetchSatellitesByGroupId.fulfilled, (state, action) => {
                state.loading = false;
                const { satellites } = action.payload;
                state.groupOfSats = normalizeGroupOfSats(satellites);
            })
            .addCase(fetchSatellitesByGroupId.rejected, (state, action) => {
                state.loading = false;
                state.error = action.payload;
            })
            .addCase(fetchSatellite.pending, (state) => {
                state.loading = true;
                state.error = null;
            })
            .addCase(fetchSatellite.fulfilled, (state, action) => {
                state.loading = false;
                if (action.payload?.transmitters) {
                    state.satelliteData = {
                        ...action.payload,
                        transmitters: normalizeTransmitters(action.payload.transmitters),
                    };
                } else {
                    state.satelliteData = action.payload;
                }
                state.error = null;
            })
            .addCase(fetchSatellite.rejected, (state, action) => {
                state.loading = false;
                state.error = action.payload;
            })
            .addCase(getTrackingStateFromBackend.pending, (state) => {
                state.loading = true;
                state.error = null;
            })
            .addCase(getTrackingStateFromBackend.fulfilled, (state, action) => {
                state.loading = false;
                // Handle null/undefined payload for first-time users
                if (action.payload && action.payload['value']) {
                    state.trackingState = action.payload['value'];
                    state.selectedRadioRig = action.payload['value']['rig_id'];
                    state.selectedRotator = action.payload['value']['rotator_id'];
                }
                // Don't sync selectedRigVFO from backend - it's session-specific
                state.error = null;
            })
            .addCase(getTrackingStateFromBackend.rejected, (state, action) => {
                state.loading = false;
                state.error = action.payload;
            })
            .addCase(setTargetMapSetting.pending, (state) => {
                state.loading = true;
                state.error = null;
            })
            .addCase(setTargetMapSetting.fulfilled, (state, action) => {
                state.loading = false;
                state.error = null;
            })
            .addCase(setTargetMapSetting.rejected, (state, action) => {
                state.loading = false;
                state.error = action.payload;
            })
            .addCase(getTargetMapSettings.pending, (state) => {
                state.loading = true;
                state.error = null;
            })
            .addCase(getTargetMapSettings.fulfilled, (state, action) => {
                state.loading = false;
                // Handle null/undefined payload for first-time users
                if (action.payload) {
                    state.tileLayerID = action.payload['tileLayerID'];
                    state.showPastOrbitPath = action.payload['showPastOrbitPath'];
                    state.showFutureOrbitPath = action.payload['showFutureOrbitPath'];
                    state.showSatelliteCoverage = action.payload['showSatelliteCoverage'];
                    state.showSunIcon = action.payload['showSunIcon'];
                    state.showMoonIcon = action.payload['showMoonIcon'];
                    state.showTerminatorLine = action.payload['showTerminatorLine'];
                    state.showTooltip = action.payload['showTooltip'];
                    state.showGrid = action.payload['showGrid'];
                    state.pastOrbitLineColor = action.payload['pastOrbitLineColor'];
                    state.futureOrbitLineColor = action.payload['futureOrbitLineColor'];
                    state.satelliteCoverageColor = action.payload['satelliteCoverageColor'];
                    state.orbitProjectionDuration = action.payload['orbitProjectionDuration'];
                }
            })
            .addCase(getTargetMapSettings.rejected, (state, action) => {
                state.loading = false;
                state.error = action.payload;
            })
            .addCase(sendNudgeCommand.pending, (state) => {
                state.loading = true;
                state.error = null;
            })
            .addCase(sendNudgeCommand.fulfilled, (state, action) => {
                state.loading = false;
                state.error = null;
            })
            .addCase(sendNudgeCommand.rejected, (state, action) => {
                state.loading = false;
                state.error = action.payload;
            });
    }
});

export const {
    setSatelliteData,
    setSatellitePasses,
    updateSatellitePassesWithElevationCurves,
    setSatelliteId,
    setSatGroupId,
    setShowPastOrbitPath,
    setShowFutureOrbitPath,
    setShowSatelliteCoverage,
    setShowSunIcon,
    setShowMoonIcon,
    setShowTerminatorLine,
    setShowTooltip,
    setTerminatorLine,
    setDaySidePolygon,
    setPastOrbitLineColor,
    setFutureOrbitLineColor,
    setSatelliteCoverageColor,
    setOrbitProjectionDuration,
    setTileLayerID,
    setMapZoomLevel,
    setSunPos,
    setMoonPos,
    setGridEditable,
    setSliderTimeOffset,
    setLocation,
    setLoading,
    setSatelliteSelectOpen,
    setSatelliteGroupSelectOpen,
    setGroupOfSats,
    setUITrackerDisabled,
    setStarting,
    setRadioRig,
    setRotator,
    setRigVFO,
    setVFO1,
    setVFO2,
    setOpenMapSettingsDialog,
    setOpenPassesTableSettingsDialog,
    setPassesTableColumnVisibility,
    setPassesTablePageSize,
    setNextPassesHours,
    setSelectedTransmitter,
    setAvailableTransmitters,
    setTargetTransmitters,
    setShowGrid,
    setColorMap,
    setColorMaps,
    setDbRange,
    setFFTSize,
    setFFTSizeOptions,
    setGain,
    setSampleRate,
    setCenterFrequency,
    setErrorMessage,
    setIsStreaming,
    setTargetFPS,
    setIsPlaying,
    setSettingsDialogOpen,
    setAutoDBRange,
    setActivePass,
    setRotatorConnecting,
    setRotatorDisconnecting,
    setUITrackerValues,
} = targetSatTrackSlice.actions;

export default targetSatTrackSlice.reducer;
