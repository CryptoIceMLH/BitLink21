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

import { useSelector } from "react-redux";
import { useTranslation } from 'react-i18next';
import {
    getClassNamesBasedOnGridEditing,
    TitleBar,
    getFrequencyBand,
    getBandColor
} from "../common/common.jsx";
import {
    Box,
    Typography,
    Chip
} from '@mui/material';
import RadioIcon from '@mui/icons-material/Radio';
import SettingsInputAntennaIcon from '@mui/icons-material/SettingsInputAntenna';
import SignalCellularAltIcon from '@mui/icons-material/SignalCellularAlt';
import Grid from "@mui/material/Grid";
import React from "react";

const TargetSatelliteTransmittersIsland = () => {
    const { t } = useTranslation('target');
    const { satelliteData, gridEditable } = useSelector((state) => state.targetSatTrack);

    // Frequency band badge
    const BandBadge = ({ band }) => {
        return (
            <Box sx={{
                px: 0.75,
                py: 0.25,
                bgcolor: getBandColor(band),
                borderRadius: 0.5,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                minWidth: 32
            }}>
                <Typography variant="caption" sx={{
                    color: '#ffffff',
                    fontSize: '0.65rem',
                    fontWeight: 700,
                    letterSpacing: '0.3px'
                }}>
                    {band}
                </Typography>
            </Box>
        );
    };

    const TransmitterRow = ({ transmitter, index }) => {
        const band = transmitter.downlink_low ? getFrequencyBand(transmitter.downlink_low) : 'N/A';
        const isActive = transmitter.alive && transmitter.status === 'active';

        return (
            <Box sx={{
                p: 1,
                mb: 0.75,
                bgcolor: 'overlay.light',
                borderRadius: 1,
                borderLeft: '3px solid',
                borderLeftColor: isActive ? 'success.main' : 'text.disabled',
                transition: 'all 0.2s',
                '&:hover': {
                    bgcolor: 'overlay.main'
                }
            }}>
                <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', mb: 0.75 }}>
                    <Box sx={{ flex: 1 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.25 }}>
                            <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.primary', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                {transmitter.description}
                            </Typography>
                            <BandBadge band={band} />
                        </Box>
                    </Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <Chip
                            label={transmitter.status}
                            size="small"
                            color={transmitter.status === 'active' ? 'success' : 'default'}
                            sx={{ height: 16, fontSize: '0.6rem', fontWeight: 600 }}
                        />
                    </Box>
                </Box>

                <Grid container spacing={0.5}>
                    <Grid size={4}>
                        <Box sx={{ display: 'flex', flexDirection: 'column' }}>
                            <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.6rem', textTransform: 'uppercase' }}>
                                {t('satellite_transmitters.labels.downlink')}
                            </Typography>
                            <Typography variant="caption" sx={{ fontWeight: 700, color: 'primary.main', fontFamily: 'monospace', fontSize: '0.7rem' }}>
                                {transmitter.downlink_low ? `${(transmitter.downlink_low / 1e6).toFixed(3)}` : t('satellite_info.values.na')}
                                {transmitter.downlink_low && <Typography component="span" sx={{ ml: 0.25, fontSize: '0.6rem', color: 'text.secondary' }}>MHz</Typography>}
                            </Typography>
                            <Typography variant="caption" sx={{ fontWeight: 700, color: 'primary.light', fontFamily: 'monospace', fontSize: '0.65rem', mt: 0.25 }}>
                                {transmitter.downlink_high ? `${(transmitter.downlink_high / 1e6).toFixed(3)} MHz` : 'N/A'}
                            </Typography>
                            <Typography variant="caption" sx={{ color: 'warning.light', fontSize: '0.6rem', fontFamily: 'monospace', mt: 0.25 }}>
                                {transmitter.downlink_drift ? `Δ ${transmitter.downlink_drift > 0 ? '+' : ''}${(transmitter.downlink_drift / 1e3).toFixed(1)} kHz` : 'Δ N/A'}
                            </Typography>
                        </Box>
                    </Grid>
                    <Grid size={4}>
                        <Box sx={{ display: 'flex', flexDirection: 'column' }}>
                            <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.6rem', textTransform: 'uppercase' }}>
                                Uplink
                            </Typography>
                            <Typography variant="caption" sx={{ fontWeight: 700, color: 'secondary.main', fontFamily: 'monospace', fontSize: '0.7rem' }}>
                                {transmitter.uplink_low ? `${(transmitter.uplink_low / 1e6).toFixed(3)}` : t('satellite_info.values.na')}
                                {transmitter.uplink_low && <Typography component="span" sx={{ ml: 0.25, fontSize: '0.6rem', color: 'text.secondary' }}>MHz</Typography>}
                            </Typography>
                            <Typography variant="caption" sx={{ fontWeight: 700, color: 'secondary.light', fontFamily: 'monospace', fontSize: '0.65rem', mt: 0.25 }}>
                                {transmitter.uplink_high ? `${(transmitter.uplink_high / 1e6).toFixed(3)} MHz` : 'N/A'}
                            </Typography>
                            <Typography variant="caption" sx={{ color: 'warning.light', fontSize: '0.6rem', fontFamily: 'monospace', mt: 0.25 }}>
                                {transmitter.uplink_drift ? `Δ ${transmitter.uplink_drift > 0 ? '+' : ''}${(transmitter.uplink_drift / 1e3).toFixed(1)} kHz` : 'Δ N/A'}
                            </Typography>
                        </Box>
                    </Grid>
                    <Grid size={4}>
                        <Box sx={{ display: 'flex', flexDirection: 'column' }}>
                            <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.6rem', textTransform: 'uppercase' }}>
                                {t('satellite_transmitters.labels.mode')}
                            </Typography>
                            <Typography variant="caption" sx={{ fontWeight: 700, color: 'secondary.main', fontSize: '0.7rem' }}>
                                {transmitter.mode || t('satellite_info.values.na')}
                                {transmitter.uplink_mode && transmitter.uplink_mode !== transmitter.mode && (
                                    <Typography component="span" sx={{ ml: 0.25, fontSize: '0.6rem', color: 'text.secondary' }}>
                                        / {transmitter.uplink_mode}
                                    </Typography>
                                )}
                            </Typography>
                        </Box>
                    </Grid>
                    <Grid size={4}>
                        <Box sx={{ display: 'flex', flexDirection: 'column' }}>
                            <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.6rem', textTransform: 'uppercase' }}>
                                {t('satellite_transmitters.labels.baud')}
                            </Typography>
                            <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.primary', fontFamily: 'monospace', fontSize: '0.7rem' }}>
                                {transmitter.baud !== null && transmitter.baud !== 0 ? `${transmitter.baud}` : t('satellite_info.values.na')}
                                {transmitter.baud !== null && transmitter.baud !== 0 && <Typography component="span" sx={{ ml: 0.25, fontSize: '0.6rem', color: 'text.secondary' }}>bps</Typography>}
                            </Typography>
                        </Box>
                    </Grid>
                    <Grid size={4}>
                        <Box sx={{ display: 'flex', flexDirection: 'column' }}>
                            <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.6rem', textTransform: 'uppercase' }}>
                                Service
                            </Typography>
                            <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.primary', fontSize: '0.7rem' }}>
                                {transmitter.service || t('satellite_info.values.na')}
                            </Typography>
                        </Box>
                    </Grid>
                    <Grid size={4}>
                        <Box sx={{ display: 'flex', flexDirection: 'column' }}>
                            <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.6rem', textTransform: 'uppercase' }}>
                                Type
                            </Typography>
                            <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.primary', fontSize: '0.7rem' }}>
                                {transmitter.type || t('satellite_info.values.na')}
                            </Typography>
                        </Box>
                    </Grid>
                </Grid>

                {/* Additional metadata row */}
                {(transmitter.invert || transmitter.unconfirmed) && (
                    <Box sx={{ mt: 0.75, display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                        {transmitter.invert && (
                            <Chip
                                label="Inverted"
                                size="small"
                                sx={{ height: 16, fontSize: '0.55rem', bgcolor: 'warning.main', color: 'warning.contrastText' }}
                            />
                        )}
                        {transmitter.unconfirmed && (
                            <Chip
                                label="Unconfirmed"
                                size="small"
                                sx={{ height: 16, fontSize: '0.55rem', bgcolor: 'info.main', color: 'info.contrastText' }}
                            />
                        )}
                    </Box>
                )}

                {transmitter.frequency_violation && (
                    <Box sx={{
                        mt: 0.5,
                        p: 0.5,
                        bgcolor: 'error.main',
                        borderRadius: 0.5
                    }}>
                        <Typography variant="caption" sx={{ color: 'error.contrastText', fontWeight: 700, fontSize: '0.6rem', textTransform: 'uppercase' }}>
                            ⚠ {t('satellite_transmitters.messages.frequency_violation')}
                        </Typography>
                    </Box>
                )}
            </Box>
        );
    };

    const Section = ({ title, icon: Icon, children }) => (
        <Box sx={{ mb: 1.5 }}>
            <Box sx={{
                display: 'flex',
                alignItems: 'center',
                mb: 1
            }}>
                <Icon sx={{ fontSize: 14, mr: 0.75, color: 'secondary.main' }} />
                <Typography variant="overline" sx={{
                    fontSize: '0.7rem',
                    fontWeight: 700,
                    color: 'secondary.main',
                    letterSpacing: '0.5px'
                }}>
                    {title}
                </Typography>
            </Box>
            {children}
        </Box>
    );

    const bands = satelliteData && satelliteData['transmitters']
        ? satelliteData['transmitters']
            .map(t => getFrequencyBand(t['downlink_low']))
            .filter((v, i, a) => a.indexOf(v) === i)
        : [];

    return (
        <Box sx={{
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            bgcolor: 'background.paper',
            backdropFilter: 'blur(10px)',
            backgroundImage: 'linear-gradient(rgba(255, 255, 255, 0.05), rgba(255, 255, 255, 0.05))'
        }}>
            {/* Header */}
            <TitleBar
                className={getClassNamesBasedOnGridEditing(gridEditable, ["window-title-bar"])}
                sx={{
                    bgcolor: 'background.titleBar',
                    borderBottom: '1px solid',
                    borderColor: 'border.main',
                    backdropFilter: 'blur(10px)'
                }}
            >
                <Box sx={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%'}}>
                    <Box sx={{display: 'flex', alignItems: 'center'}}>
                        <Typography variant="subtitle2" sx={{fontWeight: 'bold'}}>
                            {t('satellite_transmitters.title')}
                        </Typography>
                    </Box>
                    <Typography variant="caption" sx={{color: 'text.secondary'}}>
                        {t('satellite_transmitters.count')}: {satelliteData && satelliteData['transmitters'] ? satelliteData['transmitters'].length : '0'}
                    </Typography>
                </Box>
            </TitleBar>

            {/* Main Content */}
            {satelliteData && satelliteData['transmitters'] && satelliteData['transmitters'].length > 0 ? (
                <Box sx={{ pr: 1.5, pl: 1.5, pt: 1.5, pb: 1, flex: 1, overflow: 'auto' }}>
                    {satelliteData['transmitters'].map((transmitter, index) => (
                        <TransmitterRow key={transmitter.id || index} transmitter={transmitter} index={index} />
                    ))}
                </Box>
            ) : (
                <Box sx={{
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    flex: 1,
                    py: 4
                }}>
                    <Typography variant="body2" sx={{ color: 'text.secondary', fontStyle: 'italic' }}>
                        {t('satellite_transmitters.messages.no_transmitters')}
                    </Typography>
                </Box>
            )}
        </Box>
    );
}

export default TargetSatelliteTransmittersIsland;
