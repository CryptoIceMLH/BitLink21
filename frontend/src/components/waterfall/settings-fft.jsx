import React from 'react';
import {
    Accordion,
    AccordionSummary,
    AccordionDetails,
    LoadingOverlay,
} from './settings-elements.jsx';
import Typography from '@mui/material/Typography';
import {
    Box,
    FormControl,
    InputLabel,
    MenuItem,
    Select,
} from "@mui/material";
import { useTranslation } from 'react-i18next';

const FftAccordion = ({
                          expanded,
                          onAccordionChange,
                          gettingSDRParameters,
                          fftSizeValues,
                          localFFTSize,
                          onFFTSizeChange,
                          fftWindowValues,
                          fftWindow,
                          onFFTWindowChange,
                          fftAveraging,
                          onFFTAveragingChange,
                          colorMaps,
                          localColorMap,
                          onColorMapChange,
                      }) => {
    const { t } = useTranslation('waterfall');

    return (
        <Accordion expanded={expanded} onChange={onAccordionChange}>
            <AccordionSummary
                sx={{
                    boxShadow: '-1px 4px 7px #00000059',
                }}
                aria-controls="panel2d-content" id="panel2d-header">
                <Typography component="span">{t('fft.title')}</Typography>
            </AccordionSummary>
            <AccordionDetails sx={{
                backgroundColor: 'background.elevated',
            }}>
                <LoadingOverlay loading={gettingSDRParameters}>
                    <Box sx={{mb: 2}}>
                        <FormControl disabled={gettingSDRParameters}
                                     margin="normal" sx={{minWidth: 200, marginTop: 0, marginBottom: 1}}
                                     fullWidth={true} variant="outlined"
                                     size="small">
                            <InputLabel>{t('fft.fft_size')}</InputLabel>
                            <Select
                                disabled={gettingSDRParameters}
                                size="small"
                                value={fftSizeValues.length ? localFFTSize : ""}
                                onChange={(e) => onFFTSizeChange(e.target.value)}
                                label={t('fft.fft_size')} variant={'outlined'}>
                                {fftSizeValues.map(size => (
                                    <MenuItem key={size} value={size}>{size}</MenuItem>
                                ))}
                            </Select>
                        </FormControl>

                        <FormControl disabled={gettingSDRParameters}
                                     sx={{minWidth: 200, marginTop: 0, marginBottom: 1}} fullWidth={true}
                                     variant="outlined" size="small">
                            <InputLabel>{t('fft.fft_window')}</InputLabel>
                            <Select
                                disabled={gettingSDRParameters}
                                size="small"
                                value={fftWindowValues.length ? fftWindow : ""}
                                onChange={(e) => onFFTWindowChange(e.target.value)}
                                label={t('fft.fft_window')} variant={'outlined'}>
                                {fftWindowValues.map(window => (
                                    <MenuItem key={window} value={window}>
                                        {window.charAt(0).toUpperCase() + window.slice(1)}
                                    </MenuItem>
                                ))}
                            </Select>
                        </FormControl>

                        <FormControl disabled={gettingSDRParameters}
                                     sx={{minWidth: 200, marginTop: 0, marginBottom: 1}} fullWidth={true}
                                     variant="outlined" size="small">
                            <InputLabel>{t('fft.fft_averaging')}</InputLabel>
                            <Select
                                disabled={gettingSDRParameters}
                                size="small"
                                value={fftAveraging}
                                onChange={(e) => onFFTAveragingChange(e.target.value)}
                                label={t('fft.fft_averaging')} variant={'outlined'}>
                                <MenuItem value={1}>{t('fft.averaging_none')}</MenuItem>
                                <MenuItem value={2}>{t('fft.averaging_samples', { count: 2 })}</MenuItem>
                                <MenuItem value={3}>{t('fft.averaging_samples', { count: 3 })}</MenuItem>
                                <MenuItem value={4}>{t('fft.averaging_samples', { count: 4 })}</MenuItem>
                                <MenuItem value={6}>{t('fft.averaging_samples', { count: 6 })}</MenuItem>
                                <MenuItem value={8}>{t('fft.averaging_samples', { count: 8 })}</MenuItem>
                            </Select>
                        </FormControl>
                        <FormControl disabled={gettingSDRParameters}
                                     sx={{minWidth: 200, marginTop: 0, marginBottom: 1}} fullWidth={true}
                                     variant="outlined"
                                     size="small">
                            <InputLabel>{t('fft.color_map')}</InputLabel>
                            <Select
                                disabled={gettingSDRParameters}
                                size="small"
                                value={localColorMap}
                                onChange={(e) => onColorMapChange(e.target.value)}
                                label={t('fft.color_map')} variant={'outlined'}>
                                {colorMaps.map(map => (
                                    <MenuItem key={map.id} value={map.id}>
                                        {map.name}
                                    </MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                    </Box>
                </LoadingOverlay>
            </AccordionDetails>
        </Accordion>
    );
};

export default FftAccordion;