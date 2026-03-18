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


import React, {useImperativeHandle, forwardRef, useCallback, useEffect, useState, useRef} from 'react';
import {Box, Typography, IconButton} from '@mui/material';
import {UnfoldMore, UnfoldLess} from '@mui/icons-material';
import {
    getClassNamesBasedOnGridEditing,
    TitleBar
} from "../common/common.jsx";
import {useSelector, useDispatch} from 'react-redux';

import {
    getSDRConfigParameters,
    setErrorDialogOpen,
    setGridEditable,
    setSdrRtlAgc,
    setSdrTunerAgc,
    setColorMap,
    setColorMaps,
    setDbRange,
    setFFTSize,
    setFFTSizeOptions,
    setFFTAveraging,
    setGain,
    setSampleRate,
    setCenterFrequency,
    setErrorMessage,
    setIsStreaming,
    setTargetFPS,
    setSettingsDialogOpen,
    setAutoDBRange,
    setSdrBiasT,
    setSdrBitpack,
    setSdrGainElement,
    setSdrClockSource,
    setSdrTimeSource,
    setSdrSettings,
    setSdrSettingsApplied,
    setFFTWindow,
    setExpandedPanels,
    setSelectedSDRId,
    setSelectedAntenna,
    setSdrSoapyAgc,
    setSelectedTransmitterId,
    setSelectedOffsetMode,
    setSelectedOffsetValue,
    startRecording,
    stopRecording,
    setRecordingName,
    incrementRecordingDuration,
    setSelectedPlaybackRecording,
    setPlaybackRecordingPath,
    clearPlaybackRecording,
    setPlaybackStartTime,
    resetPlaybackStartTime,
} from './waterfall-slice.jsx';

import {
    setVFOProperty,
    setSelectedVFO,
    setSelectedVFOTab,
    setVfoInactive,
    setVfoActive,
} from './vfo-marker/vfo-slice.jsx';

import { setTranscriptionActive } from './transcription-slice';

import {useSocket} from "../common/socket.jsx";
import { toast } from "../../utils/toast-with-timestamp.jsx";
import getValue from "lodash/_getValue.js";
import FrequencyControlAccordion from "./settings-frequency.jsx";
import SdrAccordion from "./settings-sdr.jsx";
import FftAccordion from "./settings-fft.jsx";
import VfoAccordion from "./vfo-settings/settings-vfo.jsx";
import RecordingAccordion from "./settings-recording.jsx";
import PlaybackAccordion from "./settings-playback.jsx";
import TxControlsAccordion from "./tx-controls.jsx";
import BeaconLockAccordion from "./beacon-lock-panel.jsx";
import ConstellationDiagram from "./constellation-diagram.jsx";
import RitXitControls from "./rit-xit-controls.jsx";
import { useTranslation } from 'react-i18next';

const WaterfallSettings = forwardRef(function WaterfallSettings({ playbackRemainingSecondsRef }, ref) {
    const { t } = useTranslation('waterfall');
    const dispatch = useDispatch();

    const {
        colorMap,
        colorMaps,
        dbRange,
        fftSizeOptions,
        fftSize,
        gain,
        sampleRate,
        centerFrequency,
        selectedOffsetMode,
        selectedOffsetValue,
        errorMessage,
        isStreaming,
        targetFPS,
        settingsDialogOpen,
        autoDBRange,
        gridEditable,
        
        rtlGains,
        fftWindow,
        fftWindows,
        expandedPanels,
        selectedSDRId,
        gettingSDRParameters,
        gainValues,
        sampleRateValues,
        sdrCapabilities,
        sdrSettingsById,
        hasBiasT,
        hasTunerAgc,
        hasRtlAgc,
        fftSizeValues,
        fftWindowValues,
        antennasList,
        selectedAntenna,
        hasSoapyAgc,
        
        selectedTransmitterId,
        fftAveraging,
        isRecording,
        recordingDuration,
        recordingName,
        selectedPlaybackRecording,
        playbackRecordingPath,
        playbackStartTime,
        converterDefinitions,
        activeConverterId,
    } = useSelector((state) => state.waterfall);

    // Converter: convert RF frequency (what user sees) to IF (what PlutoSDR tunes to)
    const activeConverter = converterDefinitions?.find(c => c.id === activeConverterId);
    const rfToIF = (rfFreq) => {
        if (!activeConverter || activeConverter.type === 'none') return rfFreq;
        if (activeConverter.type === 'down') return rfFreq - activeConverter.rxOffset;
        if (activeConverter.type === 'up') return rfFreq + activeConverter.rxOffset;
        return rfFreq;
    };

    const sdrSettings = sdrSettingsById?.[selectedSDRId]?.draft || {};
    const biasT = sdrSettings?.biasT ?? false;
    const tunerAgc = sdrSettings?.tunerAgc ?? false;
    const rtlAgc = sdrSettings?.rtlAgc ?? false;
    const soapyAgc = sdrSettings?.soapyAgc ?? false;

    const {
        selectedVFO,
        vfoMarkers,
        maxVFOMarkers,
        selectedVFOTab,
        vfoActive,
        vfoColors,
    } = useSelector((state) => state.vfo);

    const {
        rigData,
    } = useSelector((state) => state.targetSatTrack);

    const {
        sdrs
    } = useSelector((state) => state.sdrs);

    const {
        preferences
    } = useSelector((state) => state.preferences);

    // Helper function to get preference value
    const getPreferenceValue = useCallback((name) => {
        const preference = preferences.find((pref) => pref.name === name);
        return preference ? preference.value : '';
    }, [preferences]);

    // Check if transcription APIs are configured
    const geminiConfigured = !!getPreferenceValue('gemini_api_key');
    const deepgramConfigured = !!getPreferenceValue('deepgram_api_key');

    const [localCenterFrequency, setLocalCenterFrequency] = useState(centerFrequency);
    const [localDbRange, setLocalDbRange] = useState(dbRange);
    const [localFFTSize, setLocalFFTSize] = useState(fftSize);
    const [localSampleRate, setLocalSampleRate] = useState(sampleRate);
    const [localGain, setLocalGain] = useState(gain);
    const [localColorMap, setLocalColorMap] = useState(colorMap);
    const [localAutoDBRange, setLocalAutoDBRange] = useState(autoDBRange);
    const hasInitializedRef = useRef(false);

    const {socket} = useSocket();

    useEffect(() => {
        setLocalCenterFrequency(centerFrequency);
        setLocalDbRange(dbRange);
        setLocalFFTSize(fftSize);
        setLocalSampleRate(sampleRate);
        setLocalGain(gain);
        setLocalColorMap(colorMap);
        setLocalAutoDBRange(autoDBRange);
    }, [centerFrequency, dbRange, fftSize, sampleRate, gain, colorMap, autoDBRange]);

    useEffect(() => {
        // Only run once on mount if selectedSDRId exists and we haven't initialized yet
        if (selectedSDRId && !hasInitializedRef.current) {
            hasInitializedRef.current = true;
            handleSDRChange({target: {value: selectedSDRId}});
        }
        // No cleanup function - let the ref stay true to prevent any subsequent calls for StrictMode
    }, []);

    const handleAccordionChange = (panel) => (event, isExpanded) => {
        const updateExpandedPanels = (expandedPanels) => {
            if (isExpanded) {
                return expandedPanels.includes(panel)
                    ? expandedPanels
                    : [...expandedPanels, panel];
            }
            return expandedPanels.filter(p => p !== panel);
        };
        dispatch(setExpandedPanels(updateExpandedPanels(expandedPanels)));
    };

    const getValidGainElements = (sdrId) => {
        const caps = sdrCapabilities?.[sdrId];
        return Array.isArray(caps?.gain_elements?.rx) ? caps.gain_elements.rx : [];
    };

    const filterGains = (gains, sdrId) => {
        if (!gains || typeof gains !== 'object') {
            return {};
        }
        const valid = getValidGainElements(sdrId);
        if (valid.length === 0) {
            return gains;
        }
        const filtered = {};
        valid.forEach((name) => {
            if (Object.prototype.hasOwnProperty.call(gains, name)) {
                filtered[name] = gains[name];
            }
        });
        return filtered;
    };

    // Convert to useCallback to ensure stability of the function reference
    const sendSDRConfigToBackend = useCallback((updates = {}) => {
            const targetSDRId = updates.selectedSDRId ?? selectedSDRId;
            if (targetSDRId !== "none" && targetSDRId !== "") {
                // For sigmfplayback, NEVER send configure without a recording path
                // This prevents overwriting the session with empty recording_path
                if (targetSDRId === "sigmf-playback" && !playbackRecordingPath) {
                    return;
                }

                let SDRSettings = {
                    selectedSDRId: targetSDRId,
                    centerFrequency: rfToIF(centerFrequency),
                    sampleRate: sampleRate,
                    gain: gain,
                    fftSize: fftSize,
                    biasT: biasT,
                    tunerAgc: tunerAgc,
                    rtlAgc: rtlAgc,
                    fftWindow: fftWindow,
                    antenna: selectedAntenna,
                    soapyAgc: soapyAgc,
                    offsetFrequency: selectedOffsetValue,
                    fftAveraging: fftAveraging,
                    recordingPath: playbackRecordingPath,
                    sdrSettings: sdrSettingsById?.[targetSDRId]?.draft || {},
                }
                SDRSettings = {...SDRSettings, ...updates};
                if (SDRSettings.sdrSettings) {
                    SDRSettings = {
                        ...SDRSettings,
                        sdrSettings: {
                            ...(SDRSettings.sdrSettings || {}),
                            gains: filterGains(SDRSettings.sdrSettings?.gains, targetSDRId),
                        },
                    };
                }
                socket.emit('sdr_data', 'configure-sdr', SDRSettings);
                if (SDRSettings.sdrSettings) {
                    dispatch(
                        setSdrSettingsApplied({
                            sdrId: targetSDRId,
                            settings: SDRSettings.sdrSettings,
                        })
                    );
                }
            }
        }, [
            selectedSDRId,
            centerFrequency,
            sampleRate,
            gain,
            fftSize,
            fftWindow,
            fftAveraging,
            biasT,
            tunerAgc,
            rtlAgc,
            socket,
            selectedOffsetValue,
            playbackRecordingPath,
            selectedAntenna,
            soapyAgc,
            isStreaming,
            sdrSettingsById,
            sdrCapabilities,
        ]
    );

    // Convert to useCallback to ensure stability of the function reference
    const handleSDRChange = useCallback((event) => {
        // Check what was selected
        const selectedValue = typeof event === 'object' ? event.target.value : event;

        dispatch(setSelectedSDRId(selectedValue));

        if (selectedValue === "none") {
            // Reset UI values since once we get new values from the backend, they might not be valid anymore
            dispatch(setSampleRate("none"));
            dispatch(setGain("none"));

        } else {
            // Call the backend
            console.info(`Getting SDR parameters for SDR ${selectedValue} from the backend`);
            dispatch(getSDRConfigParameters({socket, selectedSDRId: selectedValue}))
                .unwrap()
                .then(response => {
                    const caps = response?.capabilities || {};
                    const rxGainElements = Array.isArray(caps?.gain_elements?.rx)
                        ? caps.gain_elements.rx
                        : [];
                    const hasBitpackSetting = Array.isArray(caps?.settings)
                        ? caps.settings.some((setting) => {
                            const key = (setting?.key || '').toLowerCase();
                            const name = (setting?.name || '').toLowerCase();
                            return key === 'bitpack' || name.includes('bit pack');
                        })
                        : false;

                    const existingSettings = sdrSettingsById?.[selectedValue]?.draft || {};
                    const nextSdrSettings = {
                        ...(existingSettings || {}),
                        gains: {
                            ...(existingSettings?.gains || {}),
                        },
                    };

                    if (rxGainElements.length > 0) {
                        const filteredGains = {};
                        rxGainElements.forEach((name) => {
                            if (Object.prototype.hasOwnProperty.call(nextSdrSettings.gains, name)) {
                                filteredGains[name] = nextSdrSettings.gains[name];
                            } else {
                                filteredGains[name] = null;
                            }
                        });
                        nextSdrSettings.gains = filteredGains;
                    }

                    if (hasBitpackSetting && nextSdrSettings.bitpack == null) {
                        const bitpackSetting = (caps.settings || []).find((setting) => {
                            const key = (setting?.key || '').toLowerCase();
                            const name = (setting?.name || '').toLowerCase();
                            return key === 'bitpack' || name.includes('bit pack');
                        });
                        nextSdrSettings.bitpack = Boolean(bitpackSetting?.value);
                    }

                    if (nextSdrSettings.biasT == null && caps?.bias_t?.supported) {
                        nextSdrSettings.biasT = Boolean(caps?.bias_t?.value);
                    }

                    if (nextSdrSettings.tunerAgc == null) {
                        nextSdrSettings.tunerAgc = false;
                    }
                    if (nextSdrSettings.rtlAgc == null) {
                        nextSdrSettings.rtlAgc = false;
                    }
                    if (nextSdrSettings.soapyAgc == null) {
                        nextSdrSettings.soapyAgc = false;
                    }

                    if (Array.isArray(caps?.clock_sources) && caps.clock_sources.length > 0) {
                        if (!nextSdrSettings.clockSource) {
                            nextSdrSettings.clockSource = caps.clock_source ?? caps.clock_sources[0] ?? null;
                        }
                    }

                    if (Array.isArray(caps?.time_sources) && caps.time_sources.length > 0) {
                        if (!nextSdrSettings.timeSource) {
                            nextSdrSettings.timeSource = caps.time_source ?? caps.time_sources[0] ?? null;
                        }
                    }

                    dispatch(setSdrSettings({ sdrId: selectedValue, settings: nextSdrSettings }));
                    dispatch(setSdrSettingsApplied({ sdrId: selectedValue, settings: nextSdrSettings }));
                    sendSDRConfigToBackend({
                        selectedSDRId: selectedValue,
                        sdrSettings: nextSdrSettings,
                    });
                })
                .catch(error => {
                    // Error occurred while getting SDR parameters
                    dispatch(setErrorMessage(error));
                    dispatch(setErrorDialogOpen(true));
                });
        }
    }, [dispatch, getSDRConfigParameters, sendSDRConfigToBackend, sdrSettingsById, setErrorDialogOpen, setErrorMessage, setIsStreaming, setSelectedSDRId, socket]);

    // Expose the function to parent components
    useImperativeHandle(ref, () => ({
        sendSDRConfigToBackend, handleSDRChange
    }));

    const updateCenterFrequency = (newFrequency) => (dispatch) => {
        let centerFrequency = newFrequency * 1000.0;
        dispatch(setCenterFrequency(centerFrequency));
        return sendSDRConfigToBackend({centerFrequency: rfToIF(centerFrequency)});
    };

    const updateSDRGain = (gain) => (dispatch) => {
        dispatch(setGain(gain));
        return sendSDRConfigToBackend({gain: gain});
    };

    const updateSampleRate = (sampleRate) => (dispatch) => {
        dispatch(setSampleRate(sampleRate));
        return sendSDRConfigToBackend({sampleRate: sampleRate});
    };

    const updateBiasT = (enabled) => (dispatch) => {
        if (!selectedSDRId || selectedSDRId === "none") {
            return;
        }
        dispatch(setSdrBiasT({ sdrId: selectedSDRId, value: enabled }));
        return sendSDRConfigToBackend({biasT: enabled});
    };

    const updateBitpack = (enabled) => (dispatch) => {
        if (!selectedSDRId || selectedSDRId === "none") {
            return;
        }
        dispatch(setSdrBitpack({ sdrId: selectedSDRId, value: enabled }));
        return sendSDRConfigToBackend({
            sdrSettings: {
                ...(sdrSettings || {}),
                bitpack: enabled,
                gains: sdrSettings?.gains || {},
            },
        });
    };

    const updateGainElement = (name, value) => (dispatch) => {
        if (!selectedSDRId || selectedSDRId === "none") {
            return;
        }
        const validGainElements = getValidGainElements(selectedSDRId);
        if (validGainElements.length > 0 && !validGainElements.includes(name)) {
            return;
        }
        const nextGains = {
            ...(sdrSettings?.gains || {}),
            [name]: value,
        };
        dispatch(setSdrGainElement({ sdrId: selectedSDRId, name, value }));
        return sendSDRConfigToBackend({
            sdrSettings: {
                ...(sdrSettings || {}),
                bitpack: sdrSettings?.bitpack ?? null,
                gains: filterGains(nextGains, selectedSDRId),
            },
        });
    };

    const updateClockSource = (value) => (dispatch) => {
        if (!selectedSDRId || selectedSDRId === "none") {
            return;
        }
        dispatch(setSdrClockSource({ sdrId: selectedSDRId, value }));
        return sendSDRConfigToBackend({
            sdrSettings: {
                ...(sdrSettings || {}),
                clockSource: value,
            },
        });
    };

    const updateTimeSource = (value) => (dispatch) => {
        if (!selectedSDRId || selectedSDRId === "none") {
            return;
        }
        dispatch(setSdrTimeSource({ sdrId: selectedSDRId, value }));
        return sendSDRConfigToBackend({
            sdrSettings: {
                ...(sdrSettings || {}),
                timeSource: value,
            },
        });
    };
    const updateTunerAgc = (enabled) => (dispatch) => {
        if (!selectedSDRId || selectedSDRId === "none") {
            return;
        }
        dispatch(setSdrTunerAgc({ sdrId: selectedSDRId, value: enabled }));
        return sendSDRConfigToBackend({tunerAgc: enabled});
    };

    const updateRtlAgc = (enabled) => (dispatch) => {
        if (!selectedSDRId || selectedSDRId === "none") {
            return;
        }
        dispatch(setSdrRtlAgc({ sdrId: selectedSDRId, value: enabled }));
        return sendSDRConfigToBackend({rtlAgc: enabled});
    };

    const updateFFTSize = (fftSize) => (dispatch) => {
        dispatch(setFFTSize(fftSize));
        return sendSDRConfigToBackend({fftSize: fftSize});
    };

    const updateFFTWindow = (fftWindow) => (dispatch) => {
        dispatch(setFFTWindow(fftWindow));
        return sendSDRConfigToBackend({fftWindow: fftWindow});
    };

    const updateFFTAveraging = (fftAveraging) => (dispatch) => {
        dispatch(setFFTAveraging(fftAveraging));
        return sendSDRConfigToBackend({fftAveraging: fftAveraging});
    };

    const updateSelectedAntenna = (antenna) => (dispatch) => {
        dispatch(setSelectedAntenna(antenna));
        return sendSDRConfigToBackend({antenna: antenna});
    };

    const updateSoapyAgc = (enabled) => (dispatch) => {
        if (!selectedSDRId || selectedSDRId === "none") {
            return;
        }
        dispatch(setSdrSoapyAgc({ sdrId: selectedSDRId, value: enabled }));
        return sendSDRConfigToBackend({soapyAgc: enabled});
    };

    function handleTransmitterChange(event) {
        // If a transmitter was selected, then set the SDR center frequency
        dispatch(setSelectedTransmitterId(event.target.value));

        // Handle "none" selection - don't update frequency
        if (event.target.value === "none") {
            return;
        }

        const selectedTransmitterMetadata = (rigData?.transmitters || []).find(t => t.id === event.target.value);
        if (!selectedTransmitterMetadata) {
            return;
        }

        const targetFrequency = selectedTransmitterMetadata['downlink_low'] || 0;

        // Calculate offset to avoid DC spike at center.
        // If sample rate is unset (e.g., "none"), fall back to no offset.
        const parsedSampleRate = typeof sampleRate === 'number' ? sampleRate : Number(sampleRate);
        const offsetHz = Number.isFinite(parsedSampleRate) ? parsedSampleRate * 0.25 : 0;
        const newCenterFrequency = targetFrequency + offsetHz;

        dispatch(setCenterFrequency(newCenterFrequency));
        sendSDRConfigToBackend({centerFrequency: newCenterFrequency});
    }

    function handleOffsetModeChange(event) {
        const offsetValue = event.target.value;

        if (offsetValue === "none") {
            dispatch(setSelectedOffsetMode(offsetValue));
            dispatch(setSelectedOffsetValue(0));
            return sendSDRConfigToBackend({offsetFrequency: 0});
        } else if (offsetValue === "manual") {
            dispatch(setSelectedOffsetMode(offsetValue));
            return sendSDRConfigToBackend({offsetFrequency: parseInt(selectedOffsetValue)});
        } else {
            dispatch(setSelectedOffsetValue(offsetValue));
            dispatch(setSelectedOffsetMode(offsetValue));
            return sendSDRConfigToBackend({offsetFrequency: parseInt(offsetValue)});
        }
    }

    function handleOffsetValueChange(param) {
        const offsetValue = param.target.value;
        dispatch(setSelectedOffsetValue(offsetValue));
        return sendSDRConfigToBackend({offsetFrequency: parseInt(offsetValue)});
    }

    function getProperTransmitterId() {
        const transmitters = rigData?.transmitters || [];
        if (transmitters.length > 0 && selectedTransmitterId) {
            if (transmitters.find(t => t.id === selectedTransmitterId)) {
                return selectedTransmitterId;
            } else {
                return "none";
            }
        } else {
            return "none";
        }
    }

    const handleVFOPropertyChange = (vfoNumber, updates) => {
        dispatch(setVFOProperty({ vfoNumber, updates }));
    };

    const handleVFOActiveChange = (vfoNumber, isActive) => {
        if (isActive) {
            dispatch(setVfoActive(vfoNumber));
        } else {
            dispatch(setVfoInactive(vfoNumber));
        }
    };

    const handleVFOListenChange = (vfoNumber, isListening) => {
        if (isListening) {
            dispatch(setSelectedVFO(vfoNumber));
        } else {
            dispatch(setSelectedVFO(null));
        }
    };

    const handleTranscriptionToggle = (vfoNumber, enabled, provider = 'gemini') => {
        // Use VFO's existing values, fallback to default
        const currentVfo = vfoMarkers[vfoNumber];
        const language = currentVfo?.transcriptionLanguage || 'auto';
        const translateTo = currentVfo?.transcriptionTranslateTo || 'none';

        socket.emit('data_submission', 'toggle-transcription', {
            vfoNumber,
            enabled,
            language,
            translateTo,
            provider
        }, (response) => {
            if (response.success) {
                // Update VFO state in Redux - update enabled flag and provider
                dispatch(setVFOProperty({
                    vfoNumber,
                    updates: {
                        transcriptionEnabled: enabled,
                        transcriptionProvider: provider
                    }
                }));

                // Update transcription active state in Redux
                dispatch(setTranscriptionActive(enabled));
            } else {
                toast.error(t('vfo.transcription_error', `Failed to toggle transcription: ${response.error}`));
            }
        });
    };

    const handleVFOTabChange = (newValue) => {
        dispatch(setSelectedVFOTab(newValue));
        // Convert tab index (0-3) to VFO number (1-4) and select the VFO marker
        const vfoNumber = newValue + 1;
        dispatch(setSelectedVFO(vfoNumber));
    };

    // Sync VFO tab selection when a VFO is selected on the canvas
    // Only sync when selectedVFO changes (not when tab changes manually)
    useEffect(() => {
        if (selectedVFO !== null && selectedVFO >= 1 && selectedVFO <= maxVFOMarkers) {
            const tabIndex = selectedVFO - 1; // Convert VFO number (1-4) to tab index (0-3)
            dispatch(setSelectedVFOTab(tabIndex));
        }
    }, [selectedVFO, maxVFOMarkers, dispatch]);

    // Recording timer
    useEffect(() => {
        let intervalId;
        if (isRecording) {
            intervalId = setInterval(() => {
                dispatch(incrementRecordingDuration());
            }, 1000);
        }
        return () => {
            if (intervalId) {
                clearInterval(intervalId);
            }
        };
    }, [isRecording, dispatch]);

    // Set playback start time when playback streaming starts
    useEffect(() => {
        const isPlayingback = selectedSDRId === 'sigmf-playback' && isStreaming;

        if (isPlayingback && !playbackStartTime) {
            // Playback just started, set the start time
            dispatch(setPlaybackStartTime(new Date().toISOString()));
        } else if (!isStreaming && playbackStartTime) {
            // Streaming stopped, reset start time
            dispatch(resetPlaybackStartTime());
        }
    }, [isStreaming, selectedSDRId, playbackStartTime, dispatch]);

    const handleStartRecording = (customRecordingName) => {
        // Use custom name if provided, otherwise use state
        const nameToUse = customRecordingName !== undefined ? customRecordingName : recordingName;

        dispatch(startRecording({ socket, recordingName: nameToUse, selectedSDRId }))
            .unwrap()
            .catch((error) => {
                toast.error(`Failed to start recording: ${error}`);
            });
    };

    const handleStopRecording = async () => {
        try {
            // Don't capture snapshot when stopping from UI - let background task generate waterfall
            // Note: The snapshot hook remains intact for other use cases
            const waterfallImage = null;

            // Enable auto-waterfall generation so background task creates the waterfall image
            dispatch(stopRecording({ socket, selectedSDRId, waterfallImage, skipAutoWaterfall: false }))
                .unwrap()
                .then(() => {
                    console.log('Recording stopped successfully');
                })
                .catch((error) => {
                    console.error('Failed to stop recording:', error);
                    toast.error(`Failed to stop recording: ${error}`);
                });
        } catch (error) {
            console.error('Error in handleStopRecording:', error);
            toast.error(`Failed to stop recording: ${error.message}`);
        }
    };

    const handleRecordingSelect = (recording) => {
        // When a recording is selected, auto-select the sigmfplayback SDR
        const sigmfSdr = sdrs.find(sdr => sdr.type === 'sigmfplayback');

        if (sigmfSdr) {
            // Set the selected playback recording
            dispatch(setSelectedPlaybackRecording(recording));

            // Just send the recording name, backend will resolve the full path
            const recordingPath = recording.name;
            dispatch(setPlaybackRecordingPath(recordingPath));

            // Get sample rate from recording metadata and set it in the UI
            const recordingSampleRate = recording.metadata?.sample_rate;
            if (recordingSampleRate) {
                dispatch(setSampleRate(recordingSampleRate));
            }

            // Get center frequency from recording metadata (from captures)
            const recordingCenterFreq = recording.metadata?.captures?.[0]?.["core:frequency"];
            if (recordingCenterFreq) {
                dispatch(setCenterFrequency(recordingCenterFreq));
            }

            // Set antenna to "RX" for sigmfplayback
            dispatch(setSelectedAntenna("RX"));

            // Set gain to 0 for playback
            dispatch(setGain(0));

            // Auto-select the SigMF Playback SDR
            dispatch(setSelectedSDRId(sigmfSdr.id));

            // Expand the SDR accordion
            if (!expandedPanels.includes('sdr')) {
                dispatch(setExpandedPanels([...expandedPanels, 'sdr']));
            }

            // Manually send configure-sdr with the recording path
            // since the useEffect won't have the updated playbackRecordingPath yet
            setTimeout(() => {
                const SDRSettings = {
                    selectedSDRId: sigmfSdr.id,
                    centerFrequency: recordingCenterFreq || centerFrequency,
                    sampleRate: recordingSampleRate || sampleRate,
                    gain: 0,
                    fftSize: fftSize,
                    biasT: biasT,
                    tunerAgc: tunerAgc,
                    rtlAgc: rtlAgc,
                    fftWindow: fftWindow,
                    antenna: "RX",
                    soapyAgc: soapyAgc,
                    offsetFrequency: selectedOffsetValue,
                    fftAveraging: fftAveraging,
                    recordingPath: recordingPath,
                };
                socket.emit('sdr_data', 'configure-sdr', SDRSettings);

                // Now fetch SDR parameters after configure-sdr has set the recording path
                setTimeout(() => {
                    dispatch(getSDRConfigParameters({
                        socket,
                        selectedSDRId: sigmfSdr.id
                    }));
                }, 200);
            }, 100);
        } else {
            toast.error('SigMF Playback SDR not found. Please refresh the page.');
        }
    };

    const handlePlaybackPlay = () => {
        // Playback accordion play button handles full configuration and start
        if (!isStreaming && selectedSDRId === 'sigmf-playback' && playbackRecordingPath) {
            // First configure the SDR with playback recording
            socket.emit('sdr_data', 'configure-sdr', {
                selectedSDRId: 'sigmf-playback',
                centerFrequency,
                sampleRate,
                gain,
                fftSize,
                biasT,
                tunerAgc,
                rtlAgc,
                fftWindow,
                antenna: selectedAntenna,
                offsetFrequency: selectedOffsetValue,
                soapyAgc,
                fftAveraging,
                recordingPath: playbackRecordingPath,
            }, (response) => {
                if (response['success']) {
                    // Then start streaming
                    socket.emit('sdr_data', 'start-streaming', { selectedSDRId: 'sigmf-playback' });
                    dispatch(setPlaybackStartTime(new Date().toISOString()));
                } else {
                    toast.error('Failed to configure playback: ' + (response['message'] || 'Unknown error'));
                }
            });
        } else if (!playbackRecordingPath) {
            toast.error('Please select a recording first');
        } else if (selectedSDRId !== 'sigmf-playback') {
            toast.error('Please select SigMF Playback SDR first');
        }
    };

    const handlePlaybackStop = () => {
        // Playback accordion stop button only stops playback streaming
        if (isStreaming && selectedSDRId === 'sigmf-playback') {
            socket.emit('sdr_data', 'stop-streaming', { selectedSDRId: 'sigmf-playback' });
            dispatch(resetPlaybackStartTime());
        }
    };

    const handleToggleAllAccordions = () => {
        const allPanels = ['vfo', 'freqControl', 'sdr', 'fft', 'recording', 'playback'];
        const allExpanded = allPanels.every(panel => expandedPanels.includes(panel));

        if (allExpanded) {
            // Collapse all
            dispatch(setExpandedPanels([]));
        } else {
            // Expand all
            dispatch(setExpandedPanels(allPanels));
        }
    };

    return (
        <>
            <TitleBar
                className={getClassNamesBasedOnGridEditing(gridEditable, ["window-title-bar"])}
            >
                <Box sx={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%'}}>
                    <Box sx={{display: 'flex', alignItems: 'center'}}>
                        <Typography variant="subtitle2" sx={{fontWeight: 'bold'}}>
                            {t('title')}
                        </Typography>
                    </Box>
                    <IconButton
                        size="small"
                        onClick={handleToggleAllAccordions}
                        sx={{ p: 0, minWidth: 0, width: 20, height: 20 }}
                        title={expandedPanels.length === 6 ? "Collapse All" : "Expand All"}
                    >
                        {expandedPanels.length === 6 ? <UnfoldLess sx={{ fontSize: 16 }} /> : <UnfoldMore sx={{ fontSize: 16 }} />}
                    </IconButton>
                </Box>
            </TitleBar>
            <div style={{overflowY: 'auto', height: '100%', paddingBottom: '29px'}}>

                <SdrAccordion
                    expanded={expandedPanels.includes('sdr')}
                    onAccordionChange={handleAccordionChange('sdr')}
                    gettingSDRParameters={gettingSDRParameters}
                    isStreaming={isStreaming}
                    sdrs={sdrs}
                    selectedSDRId={selectedSDRId}
                    onSDRChange={handleSDRChange}
                    gainValues={gainValues}
                    localGain={localGain}
                    onGainChange={(value) => {
                        setLocalGain(value);
                        dispatch(updateSDRGain(value));
                    }}
                    sampleRateValues={sampleRateValues}
                    localSampleRate={localSampleRate}
                    onSampleRateChange={(value) => {
                        if (!isRecording) {
                            setLocalSampleRate(value);
                            dispatch(updateSampleRate(value));
                        }
                    }}
                    antennasList={antennasList}
                    selectedAntenna={selectedAntenna}
                    onAntennaChange={(value) => dispatch(updateSelectedAntenna(value))}
                    sdrCapabilities={sdrCapabilities}
                    sdrSettings={sdrSettings}
                    hasBiasT={hasBiasT}
                    biasT={biasT}
                    onBiasTChange={(checked) => dispatch(updateBiasT(checked))}
                    onBitpackChange={(checked) => dispatch(updateBitpack(checked))}
                    onGainElementChange={(name, value) => dispatch(updateGainElement(name, value))}
                    onClockSourceChange={(value) => dispatch(updateClockSource(value))}
                    onTimeSourceChange={(value) => dispatch(updateTimeSource(value))}
                    hasTunerAgc={hasTunerAgc}
                    tunerAgc={tunerAgc}
                    onTunerAgcChange={(checked) => dispatch(updateTunerAgc(checked))}
                    hasSoapyAgc={hasSoapyAgc}
                    soapyAgc={soapyAgc}
                    onSoapyAgcChange={(checked) => dispatch(updateSoapyAgc(checked))}
                    hasRtlAgc={hasRtlAgc}
                    rtlAgc={rtlAgc}
                    onRtlAgcChange={(checked) => dispatch(updateRtlAgc(checked))}
                    isRecording={isRecording}
                />

                <FrequencyControlAccordion
                    expanded={expandedPanels.includes('freqControl')}
                    onAccordionChange={handleAccordionChange('freqControl')}
                    centerFrequency={centerFrequency}
                    onCenterFrequencyChange={(newFrequency) => {
                        if (!isRecording) {
                            dispatch(updateCenterFrequency(newFrequency));
                        }
                    }}
                    availableTransmitters={rigData?.transmitters || []}
                    getProperTransmitterId={getProperTransmitterId}
                    onTransmitterChange={handleTransmitterChange}
                    selectedOffsetMode={selectedOffsetMode}
                    onOffsetModeChange={handleOffsetModeChange}
                    selectedOffsetValue={selectedOffsetValue}
                    onOffsetValueChange={handleOffsetValueChange}
                    isRecording={isRecording}
                    selectedSDRId={selectedSDRId}
                    isStreaming={isStreaming}
                />

                {/* BitLink21 TX/Beacon/Modem — only when streaming */}
                {isStreaming && (
                    <>
                        <TxControlsAccordion
                            expanded={expandedPanels.includes('tx')}
                            onAccordionChange={handleAccordionChange('tx')}
                        />
                        <BeaconLockAccordion
                            expanded={expandedPanels.includes('beacon')}
                            onAccordionChange={handleAccordionChange('beacon')}
                        />
                    </>
                )}

                <VfoAccordion
                    expanded={expandedPanels.includes('vfo')}
                    onAccordionChange={handleAccordionChange('vfo')}
                    selectedVFOTab={selectedVFOTab}
                    onVFOTabChange={handleVFOTabChange}
                    vfoColors={vfoColors}
                    vfoMarkers={vfoMarkers}
                    vfoActive={vfoActive}
                    onVFOActiveChange={handleVFOActiveChange}
                    onVFOPropertyChange={handleVFOPropertyChange}
                    selectedVFO={selectedVFO}
                    onVFOListenChange={handleVFOListenChange}
                    onTranscriptionToggle={handleTranscriptionToggle}
                    geminiConfigured={geminiConfigured}
                    deepgramConfigured={deepgramConfigured}
                    centerFrequency={centerFrequency}
                    sampleRate={sampleRate}
                    onCenterFrequencyChange={(newFreq) => {
                        dispatch(setCenterFrequency(newFreq));
                        sendSDRConfigToBackend({centerFrequency: rfToIF(newFreq)});
                    }}
                />

                <FftAccordion
                    expanded={expandedPanels.includes('fft')}
                    onAccordionChange={handleAccordionChange('fft')}
                    gettingSDRParameters={gettingSDRParameters}
                    fftSizeValues={fftSizeValues}
                    localFFTSize={localFFTSize}
                    onFFTSizeChange={(value) => {
                        setLocalFFTSize(value);
                        dispatch(updateFFTSize(value));
                    }}
                    fftWindowValues={fftWindowValues}
                    fftWindow={fftWindow}
                    onFFTWindowChange={(value) => dispatch(updateFFTWindow(value))}
                    fftAveraging={fftAveraging}
                    onFFTAveragingChange={(value) => dispatch(updateFFTAveraging(value))}
                    colorMaps={colorMaps}
                    localColorMap={localColorMap}
                    onColorMapChange={(value) => {
                        setLocalColorMap(value);
                        dispatch(setColorMap(value));
                    }}
                />

                <RecordingAccordion
                    expanded={expandedPanels.includes('recording')}
                    onAccordionChange={handleAccordionChange('recording')}
                    isRecording={isRecording}
                    recordingDuration={recordingDuration}
                    recordingName={recordingName}
                    onRecordingNameChange={(name) => dispatch(setRecordingName(name))}
                    onStartRecording={handleStartRecording}
                    onStopRecording={handleStopRecording}
                    isStreaming={isStreaming}
                    selectedSDRId={selectedSDRId}
                    centerFrequency={centerFrequency}
                />

                <PlaybackAccordion
                    expanded={expandedPanels.includes('playback')}
                    onAccordionChange={handleAccordionChange('playback')}
                    isStreaming={isStreaming}
                    selectedPlaybackRecording={selectedPlaybackRecording}
                    onRecordingSelect={handleRecordingSelect}
                    onPlaybackPlay={handlePlaybackPlay}
                    onPlaybackStop={handlePlaybackStop}
                    playbackStartTime={playbackStartTime}
                    playbackRemainingSecondsRef={playbackRemainingSecondsRef}
                />

                {/* Constellation + RIT/XIT — only when streaming */}
                {isStreaming && (
                    <div style={{ padding: '8px 16px' }}>
                        <ConstellationDiagram />
                        <div style={{ marginTop: 12 }}>
                            <RitXitControls />
                        </div>
                    </div>
                )}
            </div>
        </>
    );
});

export default WaterfallSettings;
