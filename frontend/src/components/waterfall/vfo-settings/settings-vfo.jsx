/**
 * VFO Settings Accordion Component (Refactored)
 *
 * Main orchestrator for VFO settings panel
 */

import React from 'react';
import { Accordion, AccordionSummary, AccordionDetails } from '../settings-elements.jsx';
import Typography from '@mui/material/Typography';
import { Box, Tabs, Tab } from "@mui/material";
import LockIcon from '@mui/icons-material/Lock';
import VolumeUpIcon from '@mui/icons-material/VolumeUp';
import VolumeMuteIcon from '@mui/icons-material/VolumeMute';
import { useTranslation } from 'react-i18next';
import { VfoTabPanel } from './vfo-tab-panel.jsx';
import { TransmittersDialog, TranscriptionParamsDialog } from './vfo-dialogs.jsx';
import DecoderParamsDialog from '../decoder-params-dialog.jsx';
import {
    useVfoAudioState,
    useVfoDecoderInfo,
    useVfoWheelHandlers,
    useVfoSatelliteData,
    useVfoStreamingState
} from './vfo-hooks.js';

const VfoAccordion = ({
    expanded,
    onAccordionChange,
    selectedVFOTab,
    onVFOTabChange,
    vfoColors,
    vfoMarkers,
    vfoActive,
    onVFOActiveChange,
    onVFOPropertyChange,
    onTranscriptionToggle,
    geminiConfigured,
    deepgramConfigured,
    centerFrequency,
    sampleRate,
    onCenterFrequencyChange,
}) => {
    const { t } = useTranslation('waterfall');

    // Use custom hooks for state management
    const {
        vfoMuted,
        vfoBufferLengths,
        vfoAudioLevels,
        vfoRfPower,
        handleVfoMuteToggle
    } = useVfoAudioState();

    const { getVFODecoderInfo } = useVfoDecoderInfo();

    const {
        transmitters,
        targetSatelliteName,
        targetSatelliteData
    } = useVfoSatelliteData();

    const { streamingVFOs, vfoMutedRedux } = useVfoStreamingState();

    // Set up wheel event handlers for sliders
    useVfoWheelHandlers(vfoMarkers, vfoActive, onVFOPropertyChange);

    // Dialog state management
    const [transmittersDialogOpen, setTransmittersDialogOpen] = React.useState(false);
    const [decoderParamsDialogOpen, setDecoderParamsDialogOpen] = React.useState(false);
    const [decoderParamsVfoIndex, setDecoderParamsVfoIndex] = React.useState(null);
    const [transcriptionParamsDialogOpen, setTranscriptionParamsDialogOpen] = React.useState(false);
    const [transcriptionParamsVfoIndex, setTranscriptionParamsVfoIndex] = React.useState(null);

    // Dialog handlers
    const handleOpenDecoderParams = (vfoIndex) => {
        setDecoderParamsVfoIndex(vfoIndex);
        setDecoderParamsDialogOpen(true);
    };

    const handleOpenTranscriptionParams = (vfoIndex) => {
        setTranscriptionParamsVfoIndex(vfoIndex);
        setTranscriptionParamsDialogOpen(true);
    };

    return (
        <Accordion expanded={expanded} onChange={onAccordionChange}>
            <AccordionSummary
                sx={{
                    boxShadow: '-1px 4px 7px #00000059',
                }}
                aria-controls="vfo-content" id="vfo-header">
                <Typography component="span">{t('vfo.title')}</Typography>
            </AccordionSummary>
            <AccordionDetails sx={{
                backgroundColor: 'background.elevated',
            }}>
                {/* VFO Tabs */}
                <Tabs
                    value={selectedVFOTab}
                    onChange={(event, newValue) => onVFOTabChange(newValue)}
                    sx={{
                        minHeight: '32px',
                        '& .MuiTab-root': {
                            minHeight: '32px',
                            padding: '6px 12px'
                        },
                        '& .MuiTabs-indicator': {
                            backgroundColor: '#ffffffcc',
                        }
                    }}
                >
                    {[0, 1, 2, 3].map((index) => (
                        <Tab
                            key={index}
                            label={
                                <Box sx={{ position: 'relative', width: '100%', height: '100%' }}>
                                    {index + 1}
                                    {vfoMarkers[index + 1]?.lockedTransmitterId && vfoMarkers[index + 1]?.lockedTransmitterId !== 'none' && (
                                        <LockIcon
                                            sx={{
                                                position: 'absolute',
                                                top: -4,
                                                right: -8,
                                                fontSize: '0.75rem',
                                                pointerEvents: 'none',
                                            }}
                                        />
                                    )}
                                    {!streamingVFOs.includes(index + 1) && (
                                        <VolumeMuteIcon
                                            sx={{
                                                position: 'absolute',
                                                bottom: -2,
                                                right: -6,
                                                fontSize: '0.75rem',
                                                pointerEvents: 'none',
                                                color: '#888888',
                                            }}
                                        />
                                    )}
                                    {streamingVFOs.includes(index + 1) && vfoMutedRedux[index + 1] && (
                                        <VolumeMuteIcon
                                            sx={{
                                                position: 'absolute',
                                                bottom: -2,
                                                right: -6,
                                                fontSize: '0.75rem',
                                                pointerEvents: 'none',
                                                color: '#00ff00',
                                            }}
                                        />
                                    )}
                                    {streamingVFOs.includes(index + 1) && !vfoMutedRedux[index + 1] && (
                                        <VolumeUpIcon
                                            sx={{
                                                position: 'absolute',
                                                bottom: -2,
                                                right: -6,
                                                fontSize: '0.75rem',
                                                pointerEvents: 'none',
                                                color: '#00ff00',
                                            }}
                                        />
                                    )}
                                    {vfoActive[index + 1] && (
                                        <Box
                                            aria-label={`VFO ${index + 1} active`}
                                            sx={{
                                                position: 'absolute',
                                                top: -4,
                                                left: -8,
                                                width: 8,
                                                height: 8,
                                                borderRadius: '50%',
                                                bgcolor: 'success.main',
                                                boxShadow: 1,
                                            }}
                                        />
                                    )}
                                </Box>
                            }
                            sx={{
                                minWidth: '25%',
                                backgroundColor: `${vfoColors[index]}40`,
                                '&.Mui-selected': {
                                    fontWeight: 'bold',
                                    borderBottom: 'none',
                                    color: 'text.primary',
                                },
                            }}
                        />
                    ))}
                </Tabs>

                {/* VFO Tab Panels */}
                {[1, 2, 3, 4].map((vfoIndex) => (
                    <VfoTabPanel
                        key={vfoIndex}
                        vfoIndex={vfoIndex}
                        visible={(selectedVFOTab + 1) === vfoIndex}
                        vfoMarkers={vfoMarkers}
                        vfoActive={vfoActive}
                        vfoMuted={vfoMuted}
                        vfoBufferLengths={vfoBufferLengths}
                        vfoAudioLevels={vfoAudioLevels}
                        vfoRfPower={vfoRfPower}
                        transmitters={transmitters}
                        targetSatelliteName={targetSatelliteName}
                        geminiConfigured={geminiConfigured}
                        deepgramConfigured={deepgramConfigured}
                        onVFOActiveChange={onVFOActiveChange}
                        onVFOPropertyChange={onVFOPropertyChange}
                        onMuteToggle={handleVfoMuteToggle}
                        onTranscriptionToggle={onTranscriptionToggle}
                        onOpenTransmittersDialog={() => setTransmittersDialogOpen(true)}
                        onOpenDecoderParamsDialog={handleOpenDecoderParams}
                        onOpenTranscriptionParamsDialog={handleOpenTranscriptionParams}
                        getVFODecoderInfo={getVFODecoderInfo}
                        centerFrequency={centerFrequency}
                        sampleRate={sampleRate}
                        onCenterFrequencyChange={onCenterFrequencyChange}
                    />
                ))}
            </AccordionDetails>

            {/* Transmitters Dialog */}
            <TransmittersDialog
                open={transmittersDialogOpen}
                onClose={() => setTransmittersDialogOpen(false)}
                targetSatelliteName={targetSatelliteName}
                targetSatelliteData={targetSatelliteData}
            />

            {/* Decoder Parameters Dialog */}
            <DecoderParamsDialog
                open={decoderParamsDialogOpen}
                onClose={() => setDecoderParamsDialogOpen(false)}
                vfoIndex={decoderParamsVfoIndex}
                vfoMarkers={vfoMarkers}
                vfoActive={vfoActive}
                onVFOPropertyChange={onVFOPropertyChange}
            />

            {/* Transcription Parameters Dialog */}
            <TranscriptionParamsDialog
                open={transcriptionParamsDialogOpen}
                onClose={() => setTranscriptionParamsDialogOpen(false)}
                vfoIndex={transcriptionParamsVfoIndex}
                vfoMarkers={vfoMarkers}
                geminiConfigured={geminiConfigured}
                onVFOPropertyChange={onVFOPropertyChange}
                getVFODecoderInfo={getVFODecoderInfo}
            />
        </Accordion>
    );
};

export default VfoAccordion;
