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


import React, {useState} from 'react';
import {
    Box,
    Paper,
    FormControl,
    InputLabel,
    Select,
    MenuItem,
    Switch,
    FormControlLabel,
    Stack
} from '@mui/material';
import {styled} from '@mui/material/styles';
import {tileLayers, getTileLayerById} from './tile-layers.jsx';
import {TitleBar, ThemedStackIsland, SettingItem, ThemedSettingsDiv} from './common.jsx';
import { useTranslation } from 'react-i18next';


const MapSettingsIsland = ({ initialShowPastOrbitPath, initialShowFutureOrbitPath, initialShowSatelliteCoverage,
                            initialShowSunIcon, initialShowMoonIcon, initialShowTerminatorLine,
                            initialSatelliteCoverageColor, initialPastOrbitLineColor, initialFutureOrbitLineColor,
                            initialOrbitProjectionDuration, initialTileLayerID, initialShowTooltip, initialShowGrid,
                               handleShowFutureOrbitPath, handleShowPastOrbitPath,
                            handleShowSatelliteCoverage, handleSetShowSunIcon, handleSetShowMoonIcon,
                            handleShowTerminatorLine, handleFutureOrbitLineColor, handlePastOrbitLineColor,
                            handleSatelliteCoverageColor, handleOrbitProjectionDuration, handleShowTooltip,
                               handleTileLayerID, handleShowGrid, updateBackend}) => {

    const { t } = useTranslation('common');

    // Example options for orbit projection time range
    const timeOptions = [
        {value: '60',  label: t('map_settings.time_options.1_hour')},
        {value: '120', label: t('map_settings.time_options.2_hours')},
        {value: '240', label: t('map_settings.time_options.4_hours')},
        {value: '480', label: t('map_settings.time_options.8_hours')},
        {value: '720', label: t('map_settings.time_options.12_hours')},
        {value: '1440', label: t('map_settings.time_options.24_hours')},
    ];

    // State for all settings
    const [satelliteCoverage, setSatelliteCoverage] = useState(initialShowSatelliteCoverage);
    const [showPastOrbitPlot, setShowPastOrbitPlot] = useState(initialShowPastOrbitPath);
    const [showFutureOrbitPlot, setShowFutureOrbitPlot] = useState(initialShowFutureOrbitPath);
    const [showSun, setShowSun] = useState(initialShowSunIcon);
    const [showMoon, setShowMoon] = useState(initialShowMoonIcon);
    const [showTerminator, setShowTerminator] = useState(initialShowTerminatorLine);
    const [showTooltip, setShowTooltip] = useState(initialShowTooltip);
    const [pastOrbitLineColor, setPastOrbitLineColor] = useState(initialPastOrbitLineColor);
    const [futureOrbitLineColor, setFutureOrbitLineColor] = useState(initialFutureOrbitLineColor);
    const [coverageColor, setCoverageColor] = useState(initialSatelliteCoverageColor);
    const [orbitProjectionDuration, setOrbitProjectionDuration] = useState(initialOrbitProjectionDuration);
    const [tileLayerID, setTileLayerID] = useState(initialTileLayerID);
    const [showGrid, setShowGrid] = useState(initialShowGrid);

    return (
            <Stack>
                <SettingItem style={{padding: '0.5rem 0.5rem'}}>
                    <FormControl fullWidth size={"small"} variant={"outlined"}>
                        <InputLabel id="orbit-time-label">{t('map_settings.orbit_projection_time')}</InputLabel>
                        <Select
                            labelId="orbit-time-label"
                            value={orbitProjectionDuration}
                            label={t('map_settings.orbit_projection_time')}
                            onChange={(e) => {
                                handleOrbitProjectionDuration(e.target.value);
                                setOrbitProjectionDuration(e.target.value);
                                updateBackend(e.target.value);
                            }}
                            variant={"outlined"}
                        >
                            {timeOptions.map((option) => (
                                <MenuItem key={option.value} value={option.value}>
                                    {option.label}
                                </MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                </SettingItem>
                <SettingItem style={{padding: '0rem 0.5rem 0.5rem 0.5rem'}}>
                    <FormControl fullWidth size={"small"} variant={"outlined"}>
                        <InputLabel id="tile-layer-label">{t('map_settings.tile_layer')}</InputLabel>
                        <Select
                            labelId="tile-layer-label"
                            value={tileLayerID}
                            label={t('map_settings.tile_layer')}
                            onChange={(e) => {
                                setTileLayerID(e.target.value);
                                handleTileLayerID(e.target.value);
                                updateBackend(e.target.value);
                            }}
                         variant={"outlined"}>
                            {tileLayers.map((layer) => (
                                <MenuItem key={layer.id} value={layer.id}>
                                    {layer.name}
                                </MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                </SettingItem>
                <SettingItem>
                    <FormControlLabel
                        style={{padding: '0rem 0rem 0rem 1rem'}}
                        control={
                            <Switch
                                size={"small"}
                                checked={satelliteCoverage}
                                onChange={(e) => {
                                    handleShowSatelliteCoverage(e.target.checked);
                                    setSatelliteCoverage(e.target.checked);
                                    updateBackend(e.target.value);
                                }}
                            />
                        }
                        label={t('map_settings.satellite_coverage')}
                    />
                </SettingItem>
                <SettingItem>
                    <FormControlLabel
                        style={{padding: '0rem 0rem 0rem 1rem'}}
                        control={
                            <Switch
                                size={"small"}
                                checked={showPastOrbitPlot}
                                onChange={(e) => {
                                    handleShowPastOrbitPath(e.target.checked);
                                    setShowPastOrbitPlot(e.target.checked);
                                    updateBackend(e.target.value);
                                }}
                            />
                        }
                        label={t('map_settings.past_orbit_path')}
                    />
                </SettingItem>
                <SettingItem>
                    <FormControlLabel
                        style={{padding: '0rem 0rem 0rem 1rem'}}
                        control={
                            <Switch
                                size={"small"}
                                checked={showFutureOrbitPlot}
                                onChange={(e) => {
                                    handleShowFutureOrbitPath(e.target.checked);
                                    setShowFutureOrbitPlot(e.target.checked);
                                    updateBackend(e.target.value);
                                }}
                            />
                        }
                        label={t('map_settings.future_orbit_path')}
                    />
                </SettingItem>
                <SettingItem>
                    <FormControlLabel style={{padding: '0rem 0rem 0rem 1rem'}}
                        control={
                            <Switch
                                size={"small"}
                                checked={showSun}
                                onChange={(e) => {
                                    handleSetShowSunIcon(e.target.checked);
                                    setShowSun(e.target.checked);
                                    updateBackend(e.target.value);
                                }}
                            />
                        }
                        label={t('map_settings.show_sun')}
                    />
                </SettingItem>
                <SettingItem>
                    <FormControlLabel style={{padding: '0rem 0rem 0rem 1rem'}}
                        control={
                            <Switch
                                size={"small"}
                                checked={showMoon}
                                onChange={(e) => {
                                    handleSetShowMoonIcon(e.target.checked);
                                    setShowMoon(e.target.checked);
                                    updateBackend(e.target.value);
                                }}
                            />
                        }
                        label={t('map_settings.show_moon')}
                    />
                </SettingItem>
                <SettingItem>
                    <FormControlLabel style={{padding: '0rem 0rem 0rem 1rem'}}
                        control={
                            <Switch
                                size={"small"}
                                checked={showTerminator}
                                onChange={(e) => {
                                    handleShowTerminatorLine(e.target.checked);
                                    setShowTerminator(e.target.checked);
                                    updateBackend(e.target.value);
                                }}
                            />
                        }
                        label={t('map_settings.day_night_separator')}
                    />
                </SettingItem>
                <SettingItem>
                    <FormControlLabel style={{padding: '0rem 0rem 0rem 1rem'}}
                        control={
                            <Switch
                                size={"small"}
                                checked={showTooltip}
                                onChange={(e) => {
                                    handleShowTooltip(e.target.checked);
                                    setShowTooltip(e.target.checked);
                                    updateBackend(e.target.value);
                                }}
                            />
                        }
                        label={t('map_settings.satellite_tooltip')}
                    />
                </SettingItem>
                <SettingItem>
                    <FormControlLabel style={{padding: '0rem 0rem 0rem 1rem'}}
                          control={
                              <Switch
                                  size={"small"}
                                  checked={showGrid}
                                  onChange={(e) => {
                                      handleShowGrid(e.target.checked);
                                      setShowGrid(e.target.checked);
                                      updateBackend(e.target.value);
                                  }}
                              />
                          }
                          label={t('map_settings.coordinate_grid')}
                    />
                </SettingItem>
                <SettingItem>
                    <FormControlLabel
                        style={{padding: '0rem 0rem 0rem 1rem'}}
                        control={
                            <input
                                type="color"
                                value={coverageColor}
                                onChange={(e) => {
                                    handleSatelliteCoverageColor(e.target.value);
                                    setCoverageColor(e.target.value);
                                    updateBackend(e.target.value);
                                }}
                                style={{
                                    width: '40px',
                                    height: '24px',
                                    border: 'none',
                                    background: 'none',
                                }}
                            />
                        }
                        label={t('map_settings.footprint_color')}
                    />
                </SettingItem>
                <SettingItem>
                    <FormControlLabel
                        style={{padding: '0rem 0rem 0rem 1rem'}}
                        control={
                            <input
                                type="color"
                                value={pastOrbitLineColor}
                                onChange={(e) => {
                                    handlePastOrbitLineColor(e.target.value);
                                    setPastOrbitLineColor(e.target.value);
                                    updateBackend(e.target.value);
                                }}
                                style={{
                                    width: '40px',
                                    height: '24px',
                                    border: 'none',
                                    background: 'none',
                                }}
                            />
                        }
                        label={t('map_settings.past_orbit_color')}
                    />
                </SettingItem>
                <SettingItem>
                    <FormControlLabel
                        style={{padding: '0rem 0rem 0rem 1rem'}}
                        control={
                            <input
                                type="color"
                                value={futureOrbitLineColor}
                                onChange={(e) => {
                                    handleFutureOrbitLineColor(e.target.value);
                                    setFutureOrbitLineColor(e.target.value);
                                    updateBackend(e.target.value);
                                }}
                                style={{
                                    width: '40px',
                                    height: '24px',
                                    border: 'none',
                                    background: 'none',
                                }}
                            />
                        }
                        label={t('map_settings.future_orbit_color')}
                    />
                </SettingItem>
            </Stack>
    );
};

export default MapSettingsIsland;
