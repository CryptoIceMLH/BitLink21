import React, {useEffect, useState} from 'react';
import {useDispatch, useSelector} from 'react-redux';
import {useNavigate} from 'react-router';
import {
    fetchSatelliteData
} from './overview-slice.jsx';
import RocketLaunchIcon from '@mui/icons-material/RocketLaunch';
import ExploreIcon from '@mui/icons-material/Explore';
import HeightIcon from '@mui/icons-material/Height';
import SpeedIcon from '@mui/icons-material/Speed';
import UpdateIcon from '@mui/icons-material/Update';
import SatelliteIcon from '@mui/icons-material/Satellite';
import MyLocationIcon from '@mui/icons-material/MyLocation';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import { getModulationDisplay } from '../../constants/modulations';
import {
    Box,
    Typography,
    Chip,
    Button,
    CircularProgress,
    Divider,
    IconButton
} from '@mui/material';
import {
    betterDateTimes,
    betterStatusValue,
    getClassNamesBasedOnGridEditing,
    humanizeAltitude,
    humanizeDate,
    humanizeLatitude,
    humanizeLongitude,
    humanizeVelocity,
    renderCountryFlagsCSV,
    TitleBar,
    getFrequencyBand,
    getBandColor,
} from "../common/common.jsx";
import Grid from "@mui/material/Grid";
import {useSocket} from "../common/socket.jsx";
import {setTrackingStateInBackend} from "../target/target-slice.jsx";
import { toast } from '../../utils/toast-with-timestamp.jsx';
import SettingsInputAntennaIcon from "@mui/icons-material/SettingsInputAntenna";
import PublicIcon from "@mui/icons-material/Public";
import { useTranslation } from 'react-i18next';
import { SatelliteInfoDialog } from '../satellites/satellite-info-page.jsx';
// ElevationDisplay removed per request; display raw value instead

const OverviewSatelliteInfoCard = () => {
    const dispatch = useDispatch();
    const navigate = useNavigate();
    const {socket} = useSocket();
    const [dialogOpen, setDialogOpen] = useState(false);
    const { t } = useTranslation('overview');
    const {
        satelliteData,
        selectedSatelliteId,
        loading,
        error,
        gridEditable,
        selectedSatGroupId,
        selectedSatellitePositions
    } = useSelector((state) => state.overviewSatTrack);
    const {
        trackingState,
        satelliteId: trackingSatelliteId,
        selectedRadioRig,
        selectedRotator,
        selectedTransmitter
    } = useSelector(state => state.targetSatTrack);

    // Get timezone preference
    const timezone = useSelector((state) => {
        const tzPref = state.preferences?.preferences?.find(p => p.name === 'timezone');
        return tzPref?.value || 'UTC';
    });

    useEffect(() => {
        if (selectedSatelliteId) {
            dispatch(fetchSatelliteData({socket: socket, noradId: selectedSatelliteId}));
        }
    }, [selectedSatelliteId, dispatch]);

    const handleSetTrackingOnBackend = () => {
        const newTrackingState = {
            'norad_id': selectedSatelliteId,
            'group_id': selectedSatGroupId,
            'rotator_state': trackingState['rotator_state'],
            'rig_state': trackingState['rig_state'],
            'rig_id': selectedRadioRig,
            'rotator_id': selectedRotator,
            'transmitter_id': selectedTransmitter,
        };

        dispatch(setTrackingStateInBackend({socket: socket, data: newTrackingState}))
            .unwrap()
            .then((response) => {
                // Success handling
            })
            .catch((error) => {
                toast.error(t('satellite_info.failed_tracking') + `: ${error.message}`);
            });
    };

    const bands = satelliteData && satelliteData['transmitters']
        ? satelliteData['transmitters']
            .map(t => getFrequencyBand(t['downlink_low']))
            .filter((v, i, a) => a.indexOf(v) === i)
        : [];

    const modulations = satelliteData && satelliteData['transmitters']
        ? Array.from(new Set(
            satelliteData['transmitters'].flatMap(t => {
                const keywords = ['FSK', 'GMSK', 'GFSK', 'BPSK', 'SSTV', 'AFSK', 'LORA', 'CW', 'DOKA', 'FM', 'FMN', 'AM', 'LSB', 'USB'];
                const found = [];
                const mode = (t['mode'] || '').toUpperCase();
                const description = (t['description'] || '').toUpperCase();

                keywords.forEach(keyword => {
                    if (mode.includes(keyword) || description.includes(keyword)) {
                        // Use proper display name for modulation
                        found.push(getModulationDisplay(keyword));
                    }
                });

                return found;
            })
        ))
        : [];

    const DataPoint = ({ icon: Icon, label, value, color = 'text.primary', unit = '' }) => (
        <Box sx={{ mb: 0 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 0.5 }}>
                <Icon sx={{ fontSize: 14, mr: 0.5, color: color }} />
                <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 'medium' }}>
                    {label}
                </Typography>
            </Box>
            <Typography variant="body1" sx={{ fontWeight: 'bold', color: color }}>
                {value} {unit && <span style={{ fontSize: '0.8em', color: 'text.secondary' }}>{unit}</span>}
            </Typography>
        </Box>
    );

    const Section = ({ title, icon: Icon, children }) => (
        <Box sx={{ mb: 1 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                <Icon sx={{ fontSize: 16, mr: 1, color: 'secondary.main' }} />
                <Typography variant="overline" sx={{
                    fontSize: '0.75rem',
                    fontWeight: 'bold',
                    color: 'secondary.main',
                    letterSpacing: '0.5px'
                }}>
                    {title}
                </Typography>
            </Box>
            {children}
        </Box>
    );

    return (
        <Box sx={{
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            bgcolor: "background.paper",
            backdropFilter: 'blur(10px)'
        }}>
            {/* Header */}
            <TitleBar
                className={getClassNamesBasedOnGridEditing(gridEditable, ["window-title-bar"])}
                sx={{
                    bgcolor: "background.titleBar",
                    borderBottom: "1px solid",
                    borderColor: "border.main",
                    backdropFilter: 'blur(10px)'
                }}
            >
                <Box sx={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%'}}>
                    <Box sx={{display: 'flex', alignItems: 'center'}}>
                        <Typography variant="subtitle2" sx={{fontWeight: 'bold'}}>
                            {t('satellite_info.title')}
                        </Typography>
                    </Box>
                    <Typography variant="caption" sx={{color: 'text.secondary'}}>
                        ID: {!loading && satelliteData && satelliteData['details'] ? satelliteData['details']['norad_id'] : ''}
                    </Typography>
                </Box>
            </TitleBar>

            {!selectedSatelliteId ? (
                <Box sx={{
                    flex: 1,
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    px: '20px',
                }}>
                    <Typography variant="body2" sx={{ color: 'text.secondary', fontStyle: 'italic', textAlign: 'center' }}>
                        {t('satellite_info.no_satellite_selected')}
                    </Typography>
                </Box>
            ) : loading ? (
                <Box sx={{
                    flex: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'center',
                    alignItems: 'center',
                }}>
                    <CircularProgress color="secondary" />
                    <Typography variant="body2" sx={{ mt: 2, color: 'text.secondary' }}>
                        {t('satellite_info.loading')}
                    </Typography>
                </Box>
            ) : (
                <>
                    {/* Satellite Name & Status */}
                    <Box sx={{
                        p: 1,
                        background: satelliteData && satelliteData['details'] ?
                            (() => {
                                const status = satelliteData['details']['status'];
                                switch(status) {
                                    case 'alive': return (theme) => `linear-gradient(135deg, ${theme.palette.success.main}26 0%, ${theme.palette.success.main}0D 100%)`;
                                    case 'dead': return (theme) => `linear-gradient(135deg, ${theme.palette.error.main}26 0%, ${theme.palette.error.main}0D 100%)`;
                                    case 're-entered': return (theme) => `linear-gradient(135deg, ${theme.palette.warning.main}26 0%, ${theme.palette.warning.main}0D 100%)`;
                                    default: return 'overlay.light';
                                }
                            })() : 'overlay.light',
                        borderBottom: "1px solid",
                        borderColor: "divider"
                    }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                            <Box sx={{
                                width: 10,
                                height: 10,
                                borderRadius: '50%',
                                mr: 1.5,
                                bgcolor: satelliteData && satelliteData['details'] ? 
                                    (() => {
                                        const status = satelliteData['details']['status'];
                                        switch(status) {
                                            case 'alive': return 'success.main';
                                            case 'dead': return 'error.main';
                                            case 're-entered': return 'warning.main';
                                            default: return 'info.main';
                                        }
                                    })() : 'info.main',
                                boxShadow: satelliteData && satelliteData['details'] ?
                                    (() => {
                                        const status = satelliteData['details']['status'];
                                        switch(status) {
                                            case 'alive': return (theme) => `0 0 8px ${theme.palette.success.main}40`;
                                            case 'dead': return (theme) => `0 0 8px ${theme.palette.error.main}40`;
                                            case 're-entered': return (theme) => `0 0 8px ${theme.palette.warning.main}40`;
                                            default: return (theme) => `0 0 8px ${theme.palette.info.main}40`;
                                        }
                                    })() : (theme) => `0 0 8px ${theme.palette.info.main}40`
                            }}/>
                            <Box sx={{ flex: 1 }}>
                                <Typography variant="subtitle1" sx={{ fontWeight: 'bold' }}>
                                    {satelliteData && satelliteData['details'] ? satelliteData['details']['name'] : "- - - - - - - - - - -"}
                                </Typography>
                                {satelliteData && satelliteData['details'] && satelliteData['details']['name_other'] && (
                                    <Typography variant="caption" sx={{ color: 'text.disabled', fontSize: '0.65rem', display: 'block', mt: -0.5 }}>
                                        {satelliteData['details']['name_other']}
                                    </Typography>
                                )}
                            </Box>
                            {satelliteData && satelliteData['details'] && betterStatusValue(satelliteData['details']['status'])}
                        </Box>

                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                            <Typography variant="caption" sx={{ color: 'text.secondary', display: 'flex', alignItems: 'center' }}>
                                <RocketLaunchIcon sx={{ fontSize: 12, mr: 0.5 }} />
                                NORAD: {satelliteData && satelliteData['details'] ? satelliteData['details']['norad_id'] : ''}
                            </Typography>
                            <Typography variant="caption" sx={{ color: 'text.secondary', display: 'flex', alignItems: 'center' }}>
                                <UpdateIcon sx={{ fontSize: 12, mr: 0.5 }} />
                                {satelliteData && satelliteData['details'] ? humanizeDate(satelliteData['details']['updated']) : ''}
                            </Typography>
                        </Box>
                    </Box>

                    {/* Main Content */}
                    <Box sx={{ pr: 2, pl: 2, pt: 1, flex: 1, overflow: 'auto' }}>

                        {/* Position Data */}
                        <Section title={t('satellite_info.position_data')} icon={ExploreIcon}>
                            <Grid container spacing={1}>
                                <Grid size={6}>
                                    <DataPoint
                                        icon={({ sx }) => <Box sx={{ ...sx, width: 6, height: 6, borderRadius: '50%', bgcolor: 'info.light' }} />}
                                        label={t('satellite_info.latitude')}
                                        value={satelliteData && satelliteData['position'] ? humanizeLatitude(satelliteData['position']['lat']) : 'N/A'}
                                        color="info.light"
                                    />
                                </Grid>
                                <Grid size={6}>
                                    <DataPoint
                                        icon={({ sx }) => <Box sx={{ ...sx, width: 6, height: 6, borderRadius: '50%', bgcolor: 'success.light' }} />}
                                        label={t('satellite_info.longitude')}
                                        value={satelliteData && satelliteData['position'] ? humanizeLongitude(satelliteData['position']['lon']) : 'N/A'}
                                        color="success.light"
                                    />
                                </Grid>
                                <Grid size={6}>
                                    <DataPoint
                                        icon={MyLocationIcon}
                                        label={t('satellite_info.azimuth')}
                                        value={satelliteData && satelliteData['position'] && satelliteData['position']['az'] ? `${satelliteData['position']['az'].toFixed(1)}°` : 'N/A'}
                                        color="warning.light"
                                    />
                                </Grid>
                                <Grid size={6}>
                                    <Box sx={{ mb: 0 }}>
                                        <Box sx={{ display: 'flex', alignItems: 'center', mb: 0.5 }}>
                                            <HeightIcon sx={{ fontSize: 14, mr: 0.5, color: 'error.light' }} />
                                            <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 'medium' }}>
                                                {t('satellite_info.elevation')}
                                            </Typography>
                                        </Box>
                                        <Typography variant="body1" sx={{ fontWeight: 'bold' }}>
                                            {selectedSatelliteId && selectedSatellitePositions?.[selectedSatelliteId]?.el !== undefined && selectedSatellitePositions?.[selectedSatelliteId]?.el !== null
                                                ? `${selectedSatellitePositions[selectedSatelliteId].el.toFixed(1)}°`
                                                : 'N/A'}
                                        </Typography>
                                    </Box>
                                </Grid>
                            </Grid>
                        </Section>

                        <Divider sx={{ my: 0, mb: 1 }} />

                        {/* Orbital Data */}
                        <Section title={t('satellite_info.orbital_data')} icon={SpeedIcon}>
                            <Grid container spacing={1}>
                                <Grid size={6}>
                                    <Box sx={{ mb: 0 }}>
                                        <Box sx={{ display: 'flex', alignItems: 'center', mb: 0.5 }}>
                                            <HeightIcon sx={{ fontSize: 14, mr: 0.5, color: 'secondary.light' }} />
                                            <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 'medium' }}>
                                                {t('satellite_info.altitude')}
                                            </Typography>
                                        </Box>
                                        <Typography variant="body1" sx={{ fontWeight: 'bold', color: 'secondary.light' }}>
                                            {satelliteData && satelliteData['position'] ? humanizeAltitude(satelliteData['position']['alt'], 0) : 'N/A'}
                                            {satelliteData && satelliteData['position'] && <Typography component="span" sx={{ ml: 0.5, fontSize: '0.8em', color: 'text.secondary' }}>km</Typography>}
                                        </Typography>
                                    </Box>
                                </Grid>
                                <Grid size={6}>
                                    <Box sx={{ mb: 0 }}>
                                        <Box sx={{ display: 'flex', alignItems: 'center', mb: 0.5 }}>
                                            <SpeedIcon sx={{ fontSize: 14, mr: 0.5, color: 'primary.light' }} />
                                            <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 'medium' }}>
                                                {t('satellite_info.velocity')}
                                            </Typography>
                                        </Box>
                                        <Typography variant="body1" sx={{ fontWeight: 'bold', color: 'primary.light' }}>
                                            {satelliteData && satelliteData['position'] ? humanizeVelocity(satelliteData['position']['vel']) : 'N/A'}
                                            {satelliteData && satelliteData['position'] && <Typography component="span" sx={{ ml: 0.5, fontSize: '0.8em', color: 'text.secondary' }}>km/s</Typography>}
                                        </Typography>
                                    </Box>
                                </Grid>
                            </Grid>
                        </Section>

                        <Divider sx={{ my: 0, mb: 1 }} />

                        {/* Communication Data */}
                        <Section title={t('satellite_info.communication')} icon={SettingsInputAntennaIcon}>
                            <Box sx={{ mb: 1 }}>
                                <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 'medium', mb: 1, display: 'block' }}>
                                    {t('satellite_info.frequency_bands')}
                                </Typography>
                                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                                    {bands.map((band, index) => (
                                        <Chip
                                            key={index}
                                            label={band}
                                            size="small"
                                            sx={{
                                                backgroundColor: getBandColor(band),
                                                color: 'common.white',
                                                fontSize: '0.7rem',
                                                height: 24
                                            }}
                                        />
                                    ))}
                                </Box>
                            </Box>
                            <Box sx={{ mb: 0 }}>
                                <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 'medium', mb: 1, display: 'block' }}>
                                    {t('satellite_info.modulations')}
                                </Typography>
                                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                                    {modulations.length > 0 ? (
                                        modulations.map((modulation, index) => (
                                            <Chip
                                                key={index}
                                                label={modulation}
                                                size="small"
                                                sx={{
                                                    backgroundColor: 'primary.main',
                                                    color: 'common.white',
                                                    fontSize: '0.7rem',
                                                    height: 24
                                                }}
                                            />
                                        ))
                                    ) : (
                                        <Typography variant="caption" sx={{ color: 'text.secondary', fontStyle: 'italic' }}>
                                            {t('satellite_info.no_modulations')}
                                        </Typography>
                                    )}
                                </Box>
                            </Box>
                        </Section>

                        <Divider sx={{ my: 0, mb: 1 }} />

                        {/* Metadata */}
                        <Section title={t('satellite_info.metadata')} icon={PublicIcon}>
                            <Grid container spacing={2}>
                                <Grid size={6}>
                                    <Box sx={{ mb: 0 }}>
                                        <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 'medium', mb: 0.5, display: 'block' }}>
                                            {t('satellite_info.countries')}
                                        </Typography>
                                        <Box>
                                            {satelliteData && satelliteData['details'] ? (renderCountryFlagsCSV(satelliteData['details']['countries']) || t('satellite_info.unknown')) : t('satellite_info.unknown')}
                                        </Box>
                                    </Box>
                                </Grid>
                                <Grid size={6}>
                                    <Box sx={{ mb: 0 }}>
                                        <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 'medium', mb: 0.5, display: 'block' }}>
                                            {t('satellite_info.last_update')}
                                        </Typography>
                                        <Typography variant="body2" sx={{ color: 'warning.light' }}>
                                            {satelliteData && satelliteData['details'] ? betterDateTimes(satelliteData['details']['updated'], timezone) : 'N/A'}
                                        </Typography>
                                    </Box>
                                </Grid>
                            </Grid>
                        </Section>
                    </Box>

                    {/* Footer */}
                    <Box sx={{
                        p: 2,
                        borderTop: "1px solid",
                        borderColor: "divider",
                        bgcolor: 'background.default'
                    }}>
                        <Box sx={{ display: 'flex', gap: 1 }}>
                            <Button
                                disabled={!selectedSatelliteId || trackingSatelliteId === selectedSatelliteId}
                                variant="contained"
                                color="primary"
                                onClick={handleSetTrackingOnBackend}
                                sx={{
                                    flex: 1,
                                    py: 1.5,
                                    fontWeight: 'bold',
                                    borderRadius: 2
                                }}
                            >
                                {trackingSatelliteId === selectedSatelliteId ? t('satellite_info.currently_targeted') : t('satellite_info.set_as_target')}
                            </Button>
                            <IconButton
                                disabled={!selectedSatelliteId}
                                onClick={() => setDialogOpen(true)}
                                sx={{
                                    borderRadius: 2,
                                    bgcolor: 'action.hover',
                                    border: '1px solid',
                                    borderColor: 'divider',
                                    '&:hover': {
                                        bgcolor: 'action.selected',
                                    },
                                    '&:disabled': {
                                        opacity: 0.3,
                                    }
                                }}
                            >
                                <InfoOutlinedIcon />
                            </IconButton>
                        </Box>
                    </Box>
                </>
            )}

            {/* Satellite Info Dialog */}
            {satelliteData && satelliteData['details'] && (
                <SatelliteInfoDialog
                    open={dialogOpen}
                    onClose={() => setDialogOpen(false)}
                    satelliteData={{
                        ...satelliteData['details'],
                        transmitters: satelliteData['transmitters'] || []
                    }}
                />
            )}
        </Box>
    );
};

export default OverviewSatelliteInfoCard;