import { useEffect, useRef, useCallback } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useSocket } from '../common/socket.jsx';
import {
    setCenterFrequency,
    setSampleRate,
    setGain,
    setFFTSize,
    setFFTWindow,
    setFFTAveraging,
    setIsStreaming,
    setErrorMessage,
    setErrorDialogOpen,
    setStartStreamingLoading,
    setFFTdataOverflow,
    stopRecording
} from './waterfall-slice.jsx';
import { toast } from '../../utils/toast-with-timestamp.jsx';

const useWaterfallStream = ({
    workerRef,
    targetFPSRef,
    playbackElapsedSecondsRef,
    playbackRemainingSecondsRef,
    playbackTotalSecondsRef,
    getAudioState,
    initializeAudio
}) => {
    const dispatch = useDispatch();
    const { socket } = useSocket();
    const {
        selectedSDRId,
        centerFrequency,
        sampleRate,
        gain,
        fftSize,
        sdrSettingsById,
        fftWindow,
        selectedAntenna,
        selectedOffsetValue,
        fftAveraging,
        isStreaming,
        gettingSDRParameters,
        autoDBRange,
        converterDefinitions,
        activeConverterId,
        playbackRecordingPath,
        isRecording,
    } = useSelector((state) => state.waterfall);

    // Converter: convert RF frequency (what user sees) to IF (what PlutoSDR tunes to)
    const activeConverter = converterDefinitions?.find(c => c.id === activeConverterId);
    const rfToIF = (rfFreq) => {
        if (!activeConverter || activeConverter.type === 'none') return rfFreq;
        if (activeConverter.type === 'down') return rfFreq - activeConverter.rxOffset;
        if (activeConverter.type === 'up') return rfFreq + activeConverter.rxOffset;
        return rfFreq;
    };

    const biasT = sdrSettingsById?.[selectedSDRId]?.draft?.biasT ?? false;
    const tunerAgc = sdrSettingsById?.[selectedSDRId]?.draft?.tunerAgc ?? false;
    const rtlAgc = sdrSettingsById?.[selectedSDRId]?.draft?.rtlAgc ?? false;
    const soapyAgc = sdrSettingsById?.[selectedSDRId]?.draft?.soapyAgc ?? false;

    const {
        vfoActive,
    } = useSelector((state) => state.vfo);

    const animationFrameRef = useRef(null);
    const bandscopeAnimationFrameRef = useRef(null);
    const timestampWindowRef = useRef([]);
    const overflowRef = useRef(false);
    const allowedIntervalRef = useRef(0);
    const lastAllowedUpdateRef = useRef(0);
    const windowSizeMs = 1000;
    const fftDataOverflowLimit = 60;

    const cancelAnimations = useCallback(() => {
        if (workerRef.current) {
            workerRef.current.postMessage({ cmd: 'stop' });
        }
        if (animationFrameRef.current) {
            cancelAnimationFrame(animationFrameRef.current);
            animationFrameRef.current = null;
        }
        if (bandscopeAnimationFrameRef.current) {
            cancelAnimationFrame(bandscopeAnimationFrameRef.current);
            bandscopeAnimationFrameRef.current = null;
        }
    }, [workerRef]);

    useEffect(() => {
        // Note: sdr-config-error, sdr-error, sdr-config, and sdr-status are now handled
        // in the parent-level socket event handler (hooks/useSocketEventHandlers.jsx)
        // to ensure messages are always received even when this component unmounts

        socket.on('disconnect', () => {
            cancelAnimations();
            dispatch(setIsStreaming(false));
        });

        socket.on('sdr-fft-data', (payload) => {
            const now = performance.now();
            timestampWindowRef.current.push(now);
            const cutoffTime = now - windowSizeMs;
            while (timestampWindowRef.current.length > 0 && timestampWindowRef.current[0] < cutoffTime) {
                timestampWindowRef.current.shift();
            }
            const currentRate = timestampWindowRef.current.length;
            const shouldOverflow = currentRate > fftDataOverflowLimit;
            if (shouldOverflow !== overflowRef.current) {
                overflowRef.current = shouldOverflow;
                dispatch(setFFTdataOverflow(shouldOverflow));
                allowedIntervalRef.current = 1000 / fftDataOverflowLimit;
            }
            if (overflowRef.current) {
                const timeSinceLastAllowed = now - lastAllowedUpdateRef.current;
                if (timeSinceLastAllowed < allowedIntervalRef.current) {
                    timestampWindowRef.current.pop();
                    return;
                }
                lastAllowedUpdateRef.current = now;
            }
            // Extract binary data from payload (may be ArrayBuffer directly for backwards compatibility,
            // or an object with data and playback timing info for playback mode)
            const binaryData = payload.data || payload;
            const recordingDatetime = payload.recording_datetime || null;
            const playbackElapsed = payload.playback_elapsed_seconds || null;
            const playbackRemaining = payload.playback_remaining_seconds || null;
            const playbackTotal = payload.playback_total_seconds || null;

            // Update playback timing refs without causing re-renders
            if (playbackElapsedSecondsRef) {
                playbackElapsedSecondsRef.current = playbackElapsed;
            }
            if (playbackRemainingSecondsRef) {
                playbackRemainingSecondsRef.current = playbackRemaining;
            }
            if (playbackTotalSecondsRef) {
                playbackTotalSecondsRef.current = playbackTotal;
            }

            // Create a typed view over the incoming ArrayBuffer and transfer its buffer
            // to the worker to avoid structured-clone copying (zero-copy transfer).
            const floatArray = new Float32Array(binaryData);
            if (workerRef.current) {
                // After this postMessage, floatArray.buffer becomes detached in the main thread.
                // Do not reuse floatArray or its buffer hereafter.
                workerRef.current.postMessage({
                    cmd: 'updateFFTData',
                    fft: floatArray,
                    recording_datetime: recordingDatetime,
                    playback_elapsed_seconds: playbackElapsed,
                    playback_remaining_seconds: playbackRemaining,
                    playback_total_seconds: playbackTotal,
                    immediate: true,
                }, [floatArray.buffer]);
            }
        });

        return () => {
            cancelAnimations();
            socket.off('sdr-fft-data');
        };
    }, [socket, cancelAnimations, dispatch, workerRef]);

    // Effect to handle cleanup when streaming stops (from parent handler or local stop)
    useEffect(() => {
        if (!isStreaming) {
            cancelAnimations();
        }
    }, [isStreaming, cancelAnimations]);

    const startStreaming = useCallback(() => {
        if (!isStreaming) {
            // Toolbar play button should only handle real SDRs, not SigmfPlayback
            if (selectedSDRId === "sigmf-playback") {
                toast.error('Use the playback controls to play recordings');
                return;
            }

            dispatch(setStartStreamingLoading(true));
            dispatch(setErrorMessage(''));

            // Proactively ensure AudioContext is resumed before streaming starts
            // This prevents the race condition where audio arrives before context is ready
            if (getAudioState && initializeAudio) {
                const audioState = getAudioState();
                if (audioState.contextState === 'suspended') {
                    console.log('AudioContext suspended - resuming before stream start');
                    initializeAudio().catch(err => {
                        console.warn('Failed to resume AudioContext proactively:', err);
                        // Continue anyway - audio will try to resume when first packet arrives
                    });
                } else if (!audioState.enabled) {
                    console.log('Audio not enabled - initializing before stream start');
                    initializeAudio().catch(err => {
                        console.warn('Failed to initialize audio proactively:', err);
                    });
                }
            }

            socket.emit('sdr_data', 'configure-sdr', {
                selectedSDRId,
                centerFrequency: rfToIF(centerFrequency),
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
                sdrSettings: sdrSettingsById?.[selectedSDRId]?.draft || {},
            }, (response) => {
                if (response['success']) {
                    socket.emit('sdr_data', 'start-streaming', { selectedSDRId });
                    if (workerRef.current) {
                        workerRef.current.postMessage({
                            cmd: 'start',
                            data: { fps: targetFPSRef.current }
                        });
                    }
                }
            });
        }
    }, [isStreaming, dispatch, socket, selectedSDRId, centerFrequency, sampleRate, gain, fftSize, biasT, tunerAgc, rtlAgc, fftWindow, selectedAntenna, selectedOffsetValue, soapyAgc, fftAveraging, workerRef, targetFPSRef, getAudioState, initializeAudio]);

    const stopStreaming = useCallback(async () => {
        if (isStreaming) {
            // If recording is active, stop it first
            if (isRecording) {
                try {
                    // Capture waterfall snapshot
                    let waterfallImage = null;
                    try {
                        if (window.captureWaterfallSnapshot) {
                            waterfallImage = await window.captureWaterfallSnapshot(1620);
                        }
                    } catch (captureError) {
                        console.error('Error capturing waterfall:', captureError);
                    }

                    // Stop recording and wait for it to complete
                    await dispatch(stopRecording({ socket, selectedSDRId, waterfallImage })).unwrap();
                    console.log('Recording stopped successfully before stopping stream');
                } catch (error) {
                    console.error('Error stopping recording:', error);
                    toast.error(`Failed to stop recording: ${error}`);
                }
            }

            // Now stop streaming
            socket.emit('sdr_data', 'stop-streaming', { selectedSDRId });
            dispatch(setIsStreaming(false));
            cancelAnimations();
        }
    }, [isStreaming, isRecording, socket, selectedSDRId, dispatch, cancelAnimations]);

    const playButtonEnabledOrNot = useCallback(() => {
        const isStreamingActive = isStreaming;
        const noSDRSelected = selectedSDRId === 'none';
        const isSigmfPlayback = selectedSDRId === 'sigmf-playback';
        const isLoadingParameters = gettingSDRParameters;
        const missingRequiredParameters = !sampleRate || gain === null || gain === undefined || sampleRate === 'none' || gain === 'none' || selectedAntenna === 'none';
        return isStreamingActive || noSDRSelected || isSigmfPlayback || isLoadingParameters || missingRequiredParameters;
    }, [isStreaming, selectedSDRId, gettingSDRParameters, sampleRate, gain, selectedAntenna]);

    return { startStreaming, stopStreaming, playButtonEnabledOrNot };
};

export default useWaterfallStream;
