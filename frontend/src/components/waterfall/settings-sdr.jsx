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
    FormControlLabel,
    InputLabel,
    ListSubheader,
    MenuItem,
    Select,
    Switch,
} from "@mui/material";
import { useTranslation } from 'react-i18next';

const SdrAccordion = ({
                          expanded,
                          onAccordionChange,
                          gettingSDRParameters,
                          isStreaming,
                          sdrs,
                          selectedSDRId,
                          onSDRChange,
                          gainValues,
                          localGain,
                          onGainChange,
                          sampleRateValues,
                          localSampleRate,
                          onSampleRateChange,
                          antennasList,
                          selectedAntenna,
                          onAntennaChange,
                          sdrCapabilities,
                          sdrSettings,
                          hasBiasT,
                          biasT,
                          onBiasTChange,
                          onBitpackChange,
                          onClockSourceChange,
                          onTimeSourceChange,
                          hasTunerAgc,
                          tunerAgc,
                          onTunerAgcChange,
                          hasSoapyAgc,
                          soapyAgc,
                          onSoapyAgcChange,
                          hasRtlAgc,
                          rtlAgc,
                          onRtlAgcChange,
                          onGainElementChange,
                          isRecording,
                      }) => {
    const { t } = useTranslation('waterfall');
    const selectedCapabilities = sdrCapabilities?.[selectedSDRId] || null;
    const biasTSupported = hasBiasT || selectedCapabilities?.bias_t?.supported;
    const clockSourceOptions = selectedCapabilities?.clock_sources || [];
    const timeSourceOptions = selectedCapabilities?.time_sources || [];
    const selectedClockSource =
        sdrSettings?.clockSource ?? selectedCapabilities?.clock_source ?? 'none';
    const selectedTimeSource =
        sdrSettings?.timeSource ?? selectedCapabilities?.time_source ?? 'none';

    const formatList = (values) => {
        if (!values || !Array.isArray(values) || values.length === 0) {
            return '—';
        }
        return values.join(', ');
    };

    const bitpackSetting = Array.isArray(selectedCapabilities?.settings)
        ? selectedCapabilities.settings.find(
            (setting) =>
                (setting?.key || '').toLowerCase() === 'bitpack' ||
                (setting?.name || '').toLowerCase().includes('bit pack')
        )
        : null;
    const hasBitpack = Boolean(bitpackSetting);

    const refLockValue = selectedCapabilities?.sensor_values?.ref_locked;
    const hasRefLockSensor =
        refLockValue !== undefined ||
        (Array.isArray(selectedCapabilities?.sensors) &&
            selectedCapabilities.sensors.includes('ref_locked'));
    const temperatureEntries = selectedCapabilities?.sensor_values
        ? Object.entries(selectedCapabilities.sensor_values).filter(([key]) =>
            key.toLowerCase().includes('temp')
        )
        : [];

    const formatHz = (value) => {
        if (value == null || Number.isNaN(value)) {
            return '—';
        }
        if (value >= 1000000) {
            return `${(value / 1000000).toFixed(value % 1000000 === 0 ? 0 : 3)} MHz`;
        }
        return `${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 3)} kHz`;
    };

    const formatBandwidthRange = (values) => {
        if (!values || !Array.isArray(values) || values.length === 0) {
            return '—';
        }
        const min = Math.min(...values);
        const max = Math.max(...values);
        if (!Number.isFinite(min) || !Number.isFinite(max)) {
            return '—';
        }
        return `${formatHz(min)} – ${formatHz(max)}`;
    };

    const gainRangeEntries = selectedCapabilities?.gain_ranges?.rx
        ? Object.entries(selectedCapabilities.gain_ranges.rx)
        : [];
    const gainElementNames = Array.isArray(selectedCapabilities?.gain_elements?.rx)
        ? selectedCapabilities.gain_elements.rx
        : [];
    const filteredGainRangeEntries =
        gainElementNames.length > 0
            ? gainRangeEntries.filter(([name]) => gainElementNames.includes(name))
            : gainRangeEntries;

    const buildGainOptions = (min, max, step) => {
        if (step == null || step <= 0) {
            return [];
        }
        const options = [];
        let current = min;
        let guard = 0;
        const maxOptions = 200;
        while (current <= max && guard < maxOptions) {
            options.push(Number(current.toFixed(6)));
            current += step;
            guard += 1;
        }
        return options;
    };

    return (
        <Accordion expanded={expanded} onChange={onAccordionChange}>
            <AccordionSummary
                sx={{
                    boxShadow: '-1px 4px 7px #00000059',
                }}
                aria-controls="panel3d-content" id="panel3d-header">
                <Typography component="span">{t('sdr.title')}</Typography>
            </AccordionSummary>
            <AccordionDetails sx={{
                backgroundColor: 'background.elevated',
            }}>
                <LoadingOverlay loading={gettingSDRParameters}>
                    <Box sx={{mb: 2}}>

                        <FormControl disabled={isStreaming} margin="normal"
                                     sx={{minWidth: 200, marginTop: 0, marginBottom: 1}} fullWidth
                                     variant="outlined"
                                     size="small">
                            <InputLabel htmlFor="sdr-select">{t('sdr.sdr_label')}</InputLabel>
                            <Select
                                id="sdr-select"
                                value={sdrs.length > 0 ? selectedSDRId : "none"}
                                onChange={onSDRChange}
                                size="small"
                                label={t('sdr.sdr_label')}>
                                <MenuItem value="none">
                                    {t('sdr.no_sdr_selected')}
                                </MenuItem>
                                {/* Local SDRs */}
                                {sdrs.filter(sdr => sdr.type.toLowerCase().includes('local')).length > 0 && (
                                    <ListSubheader>{t('sdr.local_sdrs')}</ListSubheader>
                                )}
                                {sdrs
                                    .filter(sdr => sdr.type.toLowerCase().includes('local'))
                                    .map((sdr, index) => {
                                        return <MenuItem value={sdr.id} key={`local-${index}`}>
                                            {sdr.name} ({sdr.type})
                                        </MenuItem>;
                                    })
                                }

                                {/* Remote SDRs */}
                                {sdrs.filter(sdr => sdr.type.toLowerCase().includes('remote')).length > 0 && (
                                    <ListSubheader>{t('sdr.remote_sdrs')}</ListSubheader>
                                )}
                                {sdrs
                                    .filter(sdr => sdr.type.toLowerCase().includes('remote'))
                                    .map((sdr, index) => {
                                        return <MenuItem value={sdr.id} key={`remote-${index}`}>
                                            {sdr.name} ({sdr.type})
                                        </MenuItem>;
                                    })
                                }

                                {/* Other SDRs (neither local nor remote) */}
                                {sdrs.filter(sdr => !sdr.type.toLowerCase().includes('local') && !sdr.type.toLowerCase().includes('remote')).length > 0 && (
                                    <ListSubheader>{t('sdr.other_sdrs')}</ListSubheader>
                                )}
                                {sdrs
                                    .filter(sdr => !sdr.type.toLowerCase().includes('local') && !sdr.type.toLowerCase().includes('remote'))
                                    .map((sdr, index) => {
                                        return <MenuItem value={sdr.id} key={`other-${index}`}>
                                            {sdr.name} ({sdr.type})
                                        </MenuItem>;
                                    })
                                }
                            </Select>
                        </FormControl>

                        <FormControl disabled={gettingSDRParameters || (selectedSDRId === 'sigmf-playback' && isStreaming)}
                                     sx={{minWidth: 200, marginTop: 0, marginBottom: 1}}
                                     fullWidth={true}
                                     variant="outlined" size="small">
                            <InputLabel>{t('sdr.gain_db')}</InputLabel>
                            <Select
                                disabled={gettingSDRParameters || (selectedSDRId === 'sigmf-playback' && isStreaming)}
                                size={'small'}
                                label={t('sdr.gain_db')}
                                value={gainValues.length ? localGain : "none"}
                                onChange={(e) => onGainChange(e.target.value)}>
                                <MenuItem value="none">
                                    {t('sdr.no_gain_selected')}
                                </MenuItem>
                                {gainValues.map(gain => (
                                    <MenuItem key={gain} value={gain}>
                                        {gain} dB
                                    </MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                        {filteredGainRangeEntries.length > 0 && (
                            <Box sx={{mb: 1, display: 'grid', gap: 1}}>
                                {filteredGainRangeEntries.map(([name, range]) => {
                                    const options = buildGainOptions(
                                        range.min,
                                        range.max,
                                        range.step
                                    );
                                    if (options.length === 0) {
                                        return null;
                                    }
                                    return (
                                        <FormControl
                                            key={`gain-${name}`}
                                            disabled={gettingSDRParameters}
                                            fullWidth
                                            variant="outlined"
                                            size="small"
                                        >
                                            <InputLabel>{`Gain ${name}`}</InputLabel>
                                            <Select
                                                size="small"
                                                label={`Gain ${name}`}
                                                value={
                                                    sdrSettings?.gains?.[name] ??
                                                    "none"
                                                }
                                                onChange={(e) => {
                                                    const nextValue =
                                                        e.target.value === "none"
                                                            ? null
                                                            : e.target.value;
                                                    onGainElementChange?.(name, nextValue);
                                                }}
                                            >
                                                <MenuItem value="none">
                                                    [not configurable]
                                                </MenuItem>
                                                {options.map((option) => (
                                                    <MenuItem key={`${name}-${option}`} value={option}>
                                                        {option} dB
                                                    </MenuItem>
                                                ))}
                                            </Select>
                                        </FormControl>
                                    );
                                })}
                            </Box>
                        )}
                        <FormControl disabled={gettingSDRParameters || isRecording || (selectedSDRId === 'sigmf-playback' && isStreaming)}
                                     sx={{minWidth: 200, marginTop: 0, marginBottom: 1}}
                                     fullWidth={true}
                                     variant="outlined" size="small">
                            <InputLabel>{t('sdr.sample_rate')}</InputLabel>
                            <Select
                                disabled={gettingSDRParameters || isRecording || (selectedSDRId === 'sigmf-playback' && isStreaming)}
                                size="small"
                                value={sampleRateValues.includes(localSampleRate) ? localSampleRate : "none"}
                                onChange={(e) => onSampleRateChange(e.target.value)}
                                label={t('sdr.sample_rate')}>
                                <MenuItem value="none">
                                    {t('sdr.no_rate_selected')}
                                </MenuItem>
                                {sampleRateValues.map(rate => {
                                    // Format the sample rate for display
                                    let displayValue;
                                    if (rate >= 1000000) {
                                        displayValue = `${(rate / 1000000).toFixed(rate % 1000000 === 0 ? 0 : 3)} MHz`;
                                    } else {
                                        displayValue = `${(rate / 1000).toFixed(rate % 1000 === 0 ? 0 : 3)} kHz`;
                                    }
                                    return (
                                        <MenuItem key={rate} value={rate}>
                                            {displayValue}
                                        </MenuItem>
                                    );
                                })}
                            </Select>
                        </FormControl>
                        <FormControl disabled={gettingSDRParameters || isRecording || (selectedSDRId === 'sigmf-playback' && isStreaming)}
                                     sx={{minWidth: 200, marginTop: 0, marginBottom: 1}}
                                     fullWidth={true}
                                     variant="outlined" size="small">
                            <InputLabel>{t('sdr.antenna')}</InputLabel>
                            <Select
                                disabled={gettingSDRParameters || isRecording || (selectedSDRId === 'sigmf-playback' && isStreaming)}
                                size="small"
                                value={antennasList.rx.includes(selectedAntenna) ? selectedAntenna : "none"}
                                onChange={(e) => onAntennaChange(e.target.value)}
                                label={t('sdr.antenna')}>
                                <MenuItem value="none">
                                    {t('sdr.no_antenna_selected')}
                                </MenuItem>
                                {antennasList.rx && antennasList.rx.map(antenna => (
                                    <MenuItem key={antenna} value={antenna}>
                                        {antenna}
                                    </MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                        {clockSourceOptions.length > 0 && (
                            <FormControl
                                disabled={
                                    gettingSDRParameters ||
                                    isRecording ||
                                    (selectedSDRId === 'sigmf-playback' && isStreaming)
                                }
                                sx={{minWidth: 200, marginTop: 0, marginBottom: 1}}
                                fullWidth={true}
                                variant="outlined"
                                size="small"
                            >
                                <InputLabel>Clock Source</InputLabel>
                                <Select
                                    size="small"
                                    label="Clock Source"
                                    value={
                                        clockSourceOptions.includes(selectedClockSource)
                                            ? selectedClockSource
                                            : 'none'
                                    }
                                    onChange={(e) => onClockSourceChange?.(e.target.value)}
                                >
                                    <MenuItem value="none">
                                        None
                                    </MenuItem>
                                    {clockSourceOptions.map((source) => (
                                        <MenuItem key={source} value={source}>
                                            {source}
                                        </MenuItem>
                                    ))}
                                </Select>
                            </FormControl>
                        )}
                        {timeSourceOptions.length > 0 && (
                            <FormControl
                                disabled={
                                    gettingSDRParameters ||
                                    isRecording ||
                                    (selectedSDRId === 'sigmf-playback' && isStreaming)
                                }
                                sx={{minWidth: 200, marginTop: 0, marginBottom: 1}}
                                fullWidth={true}
                                variant="outlined"
                                size="small"
                            >
                                <InputLabel>Time Source</InputLabel>
                                <Select
                                    size="small"
                                    label="Time Source"
                                    value={
                                        timeSourceOptions.includes(selectedTimeSource)
                                            ? selectedTimeSource
                                            : 'none'
                                    }
                                    onChange={(e) => onTimeSourceChange?.(e.target.value)}
                                >
                                    <MenuItem value="none">
                                        None
                                    </MenuItem>
                                    {timeSourceOptions.map((source) => (
                                        <MenuItem key={source} value={source}>
                                            {source}
                                        </MenuItem>
                                    ))}
                                </Select>
                            </FormControl>
                        )}
                    </Box>

                    <Box sx={{mb: 0, ml: 1.5}}>
                        {biasTSupported && (
                            <FormControlLabel
                                control={
                                    <Switch
                                        disabled={gettingSDRParameters}
                                        size={'small'}
                                        checked={biasT}
                                        onChange={(e) => onBiasTChange(e.target.checked)}
                                    />
                                }
                                label={t('sdr.enable_bias_t')}
                            />
                        )}
                        {hasBitpack && (
                            <FormControlLabel
                                control={
                                    <Switch
                                        disabled={gettingSDRParameters}
                                        size={'small'}
                                        checked={Boolean(
                                            sdrSettings?.bitpack ?? bitpackSetting?.value
                                        )}
                                        onChange={(e) => onBitpackChange?.(e.target.checked)}
                                    />
                                }
                                label="Bit Packing"
                            />
                        )}
                        {hasTunerAgc && (
                            <FormControlLabel
                                control={
                                    <Switch
                                        disabled={gettingSDRParameters}
                                        size={'small'}
                                        checked={tunerAgc}
                                        onChange={(e) => onTunerAgcChange(e.target.checked)}
                                    />
                                }
                                label={t('sdr.enable_tuner_agc')}
                            />
                        )}
                        {hasSoapyAgc && (
                            <FormControlLabel
                                control={
                                    <Switch
                                        disabled={gettingSDRParameters}
                                        size={'small'}
                                        checked={soapyAgc}
                                        onChange={(e) => onSoapyAgcChange(e.target.checked)}
                                    />
                                }
                                label={t('sdr.enable_agc')}
                            />
                        )}
                        {hasRtlAgc && (
                            <FormControlLabel
                                control={
                                    <Switch
                                        disabled={gettingSDRParameters}
                                        size={'small'}
                                        checked={rtlAgc}
                                        onChange={(e) => onRtlAgcChange(e.target.checked)}
                                    />
                                }
                                label={t('sdr.enable_rtl_agc')}
                            />
                        )}
                    </Box>

                    {selectedCapabilities && (
                        <Box sx={{mt: 2}}>
                            <Box
                                sx={{
                                    display: 'grid',
                                    gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                                    gap: 0.5,
                                }}
                            >
                                {hasRefLockSensor && (
                                    <Box
                                        sx={{
                                            px: 0.75,
                                            py: 0.25,
                                            borderRadius: 1,
                                            bgcolor: 'transparent',
                                        }}
                                    >
                                        <Box sx={{display: 'flex', justifyContent: 'space-between', gap: 1}}>
                                            <Typography variant="caption" color="text.secondary">
                                                Ref Clock Lock
                                            </Typography>
                                            <Box
                                                sx={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: 0.5,
                                                    fontFamily: 'monospace',
                                                }}
                                            >
                                                <Box
                                                    sx={{
                                                        width: 8,
                                                        height: 8,
                                                        borderRadius: '50%',
                                                        bgcolor:
                                                            refLockValue === true
                                                                ? 'success.main'
                                                                : refLockValue === false
                                                                    ? 'error.main'
                                                                    : 'text.disabled',
                                                        boxShadow:
                                                            refLockValue === true
                                                                ? '0 0 6px rgba(76, 175, 80, 0.6)'
                                                                : refLockValue === false
                                                                    ? '0 0 6px rgba(244, 67, 54, 0.6)'
                                                                    : 'none',
                                                    }}
                                                />
                                                <Typography variant="caption" sx={{fontFamily: 'monospace'}}>
                                                    {refLockValue === true
                                                        ? 'Locked'
                                                        : refLockValue === false
                                                            ? 'Unlocked'
                                                            : '—'}
                                                </Typography>
                                            </Box>
                                        </Box>
                                    </Box>
                                )}
                                {temperatureEntries.length > 0 && (
                                    <Box
                                        sx={{
                                            px: 0.75,
                                            py: 0.25,
                                            borderRadius: 1,
                                            bgcolor: 'transparent',
                                            border: '1px solid',
                                            borderColor: 'divider',
                                        }}
                                    >
                                        <Box sx={{display: 'flex', justifyContent: 'space-between', gap: 1}}>
                                            <Typography variant="caption" color="text.secondary">
                                                Temperature
                                            </Typography>
                                            <Typography
                                                variant="caption"
                                                sx={{fontFamily: 'monospace'}}
                                            >
                                                {(() => {
                                                    const [, value] = temperatureEntries[0];
                                                    const numeric = typeof value === 'number'
                                                        ? value
                                                        : parseFloat(value);
                                                    if (Number.isFinite(numeric)) {
                                                        return numeric.toFixed(1);
                                                    }
                                                    return value ?? '—';
                                                })()}
                                            </Typography>
                                        </Box>
                                    </Box>
                                )}
                            </Box>

                        </Box>
                    )}
                </LoadingOverlay>
            </AccordionDetails>
        </Accordion>
    );
};

export default SdrAccordion;
