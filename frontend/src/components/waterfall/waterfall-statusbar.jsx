import React, { useState, useEffect } from 'react';
import {humanizeFrequency, humanizeNumber, WaterfallStatusBarPaper} from "../common/common.jsx";
import { useTranslation } from 'react-i18next';
import { Box, useMediaQuery } from '@mui/material';
import { useTheme } from '@mui/material/styles';

const WaterfallStatusBar = ({isStreaming, eventMetrics, centerFrequency, sampleRate, gain}) => {
    const { t } = useTranslation('waterfall');
    const [transformData, setTransformData] = useState(null);
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

    // Update transform data periodically when streaming
    useEffect(() => {
        if (!isStreaming) {
            setTransformData(null);
            return;
        }

        const updateTransform = () => {
            if (window.getWaterfallTransform) {
                setTransformData(window.getWaterfallTransform());
            }
        };

        // Initial update
        updateTransform();

        // Update every 100ms for smooth display
        const intervalId = setInterval(updateTransform, 100);

        return () => clearInterval(intervalId);
    }, [isStreaming]);

    return (
        <WaterfallStatusBarPaper>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, fontSize: '0.75rem', fontFamily: 'monospace', color: 'text.secondary', width: '100%' }}>
                <Box sx={{ display: 'flex', gap: 0.5 }}>
                    {isMobile ? (
                        <>
                            <Box component="span" sx={{ fontWeight: 500, display: 'inline-block', minWidth: '4ch', textAlign: 'right' }}>{isStreaming ? eventMetrics.current.renderWaterfallPerSecond : '-'}</Box>
                            <Box component="span" sx={{ opacity: 0.6 }}>•</Box>
                            <Box component="span" sx={{ fontWeight: 500, display: 'inline-block', minWidth: '4ch', textAlign: 'right' }}>{isStreaming ? humanizeNumber(eventMetrics.current.fftUpdatesPerSecond) : '-'}</Box>
                            <Box component="span" sx={{ opacity: 0.6 }}>•</Box>
                            <Box component="span" sx={{ fontWeight: 500, display: 'inline-block', minWidth: '4ch', textAlign: 'right' }}>{isStreaming ? humanizeNumber(eventMetrics.current.binsPerSecond) : '-'}</Box>
                            <Box component="span" sx={{ opacity: 0.6 }}>•</Box>
                            <Box component="span" sx={{ fontWeight: 500 }}>{isStreaming ? humanizeFrequency(centerFrequency) : '-'}</Box>
                            <Box component="span" sx={{ opacity: 0.6 }}>•</Box>
                            <Box component="span" sx={{ fontWeight: 500 }}>{isStreaming ? humanizeFrequency(sampleRate) : '-'}</Box>
                            <Box component="span" sx={{ opacity: 0.6 }}>•</Box>
                            <Box component="span" sx={{ fontWeight: 500 }}>{isStreaming ? `${gain} dB` : '-'}</Box>
                        </>
                    ) : (
                        <>
                            <Box component="span">FPS: <Box component="span" sx={{ fontWeight: 500, display: 'inline-block', minWidth: '4ch', textAlign: 'right' }}>{isStreaming ? eventMetrics.current.renderWaterfallPerSecond : '-'}</Box></Box>
                            <Box component="span" sx={{ opacity: 0.6 }}>•</Box>
                            <Box component="span">FFTs/s: <Box component="span" sx={{ fontWeight: 500, display: 'inline-block', minWidth: '4ch', textAlign: 'right' }}>{isStreaming ? humanizeNumber(eventMetrics.current.fftUpdatesPerSecond) : '-'}</Box></Box>
                            <Box component="span" sx={{ opacity: 0.6 }}>•</Box>
                            <Box component="span">bins/s: <Box component="span" sx={{ fontWeight: 500, display: 'inline-block', minWidth: '4ch', textAlign: 'right' }}>{isStreaming ? humanizeNumber(eventMetrics.current.binsPerSecond) : '-'}</Box></Box>
                            <Box component="span" sx={{ opacity: 0.6 }}>•</Box>
                            <Box component="span">f: <Box component="span" sx={{ fontWeight: 500 }}>{isStreaming ? humanizeFrequency(centerFrequency) : '-'}</Box></Box>
                            <Box component="span" sx={{ opacity: 0.6 }}>•</Box>
                            <Box component="span">sr: <Box component="span" sx={{ fontWeight: 500 }}>{isStreaming ? humanizeFrequency(sampleRate) : '-'}</Box></Box>
                            <Box component="span" sx={{ opacity: 0.6 }}>•</Box>
                            <Box component="span">g: <Box component="span" sx={{ fontWeight: 500 }}>{isStreaming ? `${gain} dB` : '-'}</Box></Box>
                        </>
                    )}
                </Box>
                <Box sx={{ display: { xs: 'none', lg: 'flex' }, gap: 0.5, marginLeft: 'auto' }}>
                    <Box component="span">zoom: <Box component="span" sx={{ fontWeight: 500 }}>{isStreaming && transformData ? `${transformData.scale.toFixed(1)}x` : '-'}</Box></Box>
                    <Box component="span" sx={{ opacity: 0.6 }}>•</Box>
                    <Box component="span">view: <Box component="span" sx={{ fontWeight: 500 }}>{isStreaming && transformData ? `${humanizeFrequency(transformData.startFreq)} - ${humanizeFrequency(transformData.endFreq)}` : '-'}</Box></Box>
                    <Box component="span" sx={{ opacity: 0.6 }}>•</Box>
                    <Box component="span">bw: <Box component="span" sx={{ fontWeight: 500 }}>{isStreaming && transformData ? humanizeFrequency(transformData.visibleBandwidth) : '-'}</Box></Box>
                </Box>
            </Box>
        </WaterfallStatusBarPaper>
    );
};
export default WaterfallStatusBar;
