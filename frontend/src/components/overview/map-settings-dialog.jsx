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


import {useDispatch, useSelector} from "react-redux";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import MapSettingsIsland from "../common/map-settings.jsx";
import DialogActions from "@mui/material/DialogActions";
import {Button} from "@mui/material";
import React from "react";
import { useTranslation } from 'react-i18next';
import {
    setFutureOrbitLineColor, setOrbitProjectionDuration,
    setPastOrbitLineColor, setSatelliteCoverageColor,
    setShowFutureOrbitPath, setShowMoonIcon,
    setShowPastOrbitPath,
    setShowSatelliteCoverage,
    setShowSunIcon, setShowTerminatorLine, setShowTooltip, setTileLayerID,
    setOpenMapSettingsDialog,
    setShowGrid,
} from "./overview-slice.jsx";

function MapSettingsIslandDialog({updateBackend}) {
    const dispatch = useDispatch();
    const { t } = useTranslation('overview');
    const {
        showPastOrbitPath,
        showFutureOrbitPath,
        showSatelliteCoverage,
        showSunIcon,
        showMoonIcon,
        showTerminatorLine,
        showTooltip,
        showGrid,
        pastOrbitLineColor,
        futureOrbitLineColor,
        satelliteCoverageColor,
        orbitProjectionDuration,
        tileLayerID,
        openMapSettingsDialog,
    } = useSelector(state => state.overviewSatTrack);

    const handleCloseDialog = () => {
        dispatch(setOpenMapSettingsDialog(false));
    };

    return (
        <>
            <Dialog open={openMapSettingsDialog} onClose={handleCloseDialog} fullWidth maxWidth="sm">
                <DialogTitle>{t('map_settings.title')}</DialogTitle>
                <DialogContent>
                    <MapSettingsIsland
                        initialShowPastOrbitPath={showPastOrbitPath}
                        initialShowFutureOrbitPath={showFutureOrbitPath}
                        initialShowSatelliteCoverage={showSatelliteCoverage}
                        initialShowSunIcon={showSunIcon}
                        initialShowMoonIcon={showMoonIcon}
                        initialPastOrbitLineColor={pastOrbitLineColor}
                        initialFutureOrbitLineColor={futureOrbitLineColor}
                        initialSatelliteCoverageColor={satelliteCoverageColor}
                        initialOrbitProjectionDuration={orbitProjectionDuration}
                        initialTileLayerID={tileLayerID}
                        initialShowTooltip={showTooltip}
                        initialShowTerminatorLine={showTerminatorLine}
                        initialShowGrid={showGrid}
                        handleShowPastOrbitPath={(value)=>{dispatch(setShowPastOrbitPath(value))}}
                        handleShowFutureOrbitPath={(value)=>{dispatch(setShowFutureOrbitPath(value))}}
                        handleShowSatelliteCoverage={(value)=>{dispatch(setShowSatelliteCoverage(value))}}
                        handleSetShowSunIcon={(value)=>{dispatch(setShowSunIcon(value))}}
                        handleSetShowMoonIcon={(value)=>{dispatch(setShowMoonIcon(value))}}
                        handleShowTerminatorLine={(value)=>{dispatch(setShowTerminatorLine(value))}}
                        handlePastOrbitLineColor={(value)=>{dispatch(setPastOrbitLineColor(value))}}
                        handleFutureOrbitLineColor={(value)=>{dispatch(setFutureOrbitLineColor(value))}}
                        handleSatelliteCoverageColor={(value)=>{dispatch(setSatelliteCoverageColor(value))}}
                        handleOrbitProjectionDuration={(value)=>{dispatch(setOrbitProjectionDuration(value))}}
                        handleShowTooltip={(value)=>{dispatch(setShowTooltip(value))}}
                        handleShowGrid={(value)=>{dispatch(setShowGrid(value))}}
                        handleTileLayerID={(value)=>{dispatch(setTileLayerID(value))}}
                        updateBackend={updateBackend}
                    />
                </DialogContent>
                <DialogActions>
                    <Button onClick={handleCloseDialog}>{t('map_settings.close')}</Button>
                </DialogActions>
            </Dialog>
        </>
    );
}

export default MapSettingsIslandDialog;