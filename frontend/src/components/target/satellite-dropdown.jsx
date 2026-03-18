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


import {useEffect, useState} from "react";
import {FormControl, InputLabel, MenuItem, Select} from "@mui/material";
import * as React from "react";
import {useDispatch, useSelector} from "react-redux";
import { useTranslation } from 'react-i18next';
import {
    setSatelliteGroupSelectOpen,
    setSatelliteSelectOpen,
    setSatelliteId,
    setTrackingStateInBackend,
    setAvailableTransmitters,
} from './target-slice.jsx';
import {useSocket} from "../common/socket.jsx";


function SatelliteList() {
    const dispatch = useDispatch();
    const {socket} = useSocket();
    const { t } = useTranslation('target');
    const {
        satelliteData,
        groupOfSats,
        satelliteId,
        groupId,
        loading,
        satelliteSelectOpen,
        satelliteGroupSelectOpen,
        trackingState,
        uiTrackerDisabled,
        starting,
        selectedRadioRig,
        selectedRotator,
        selectedTransmitter,
        availableTransmitters,
    } = useSelector((state) => state.targetSatTrack);

    function getTransmittersForSatelliteId(satelliteId) {
        if (satelliteId && groupOfSats.length > 0) {
            const satellite = groupOfSats.find(s => s.norad_id === satelliteId);
            if (satellite) {
                return satellite.transmitters || [];
            } else {
                return [];
            }
        }
        return [];
    }

    function setTargetSatellite(eventOrSatelliteId) {
        // Determine the satelliteId based on the input type
        const satelliteId = typeof eventOrSatelliteId === 'object'
            ? eventOrSatelliteId.target.value
            : eventOrSatelliteId;

        dispatch(setSatelliteId(satelliteId));
        dispatch(setAvailableTransmitters(getTransmittersForSatelliteId(satelliteId)));

        // Set the tracking state in the backend to the new norad id and leave the state as is
        const data = {
            ...trackingState,
            norad_id: satelliteId,
            group_id: groupId,
            rig_id: selectedRadioRig,
            rotator_id: selectedRotator,
            transmitter_id: selectedTransmitter,
        };
        dispatch(setTrackingStateInBackend({socket, data: data}));
    }

    const handleSelectOpenEvent = (event) => {
        dispatch(setSatelliteSelectOpen(true));
    };

    const handleSelectCloseEvent = (event) => {
        dispatch(setSatelliteSelectOpen(false));
    };

    return (
        <FormControl
            disabled={trackingState['rotator_state'] === "tracking" || trackingState['rig_state'] === "tracking"}
            sx={{ margin: 0 }}
            fullWidth={true}
            size="small">
            <InputLabel htmlFor="satellite-select">{t('satellite_dropdown.label')}</InputLabel>
            <Select onClose={handleSelectCloseEvent}
                    onOpen={handleSelectOpenEvent}
                    value={groupOfSats.length > 0 && groupOfSats.find(s => s.norad_id === satelliteId) ? satelliteId : ""}
                    id="satellite-select" label={t('satellite_dropdown.label')}
                    size="small"
                    onChange={setTargetSatellite}>
                {groupOfSats.map((satellite, index) => {
                    return <MenuItem value={satellite['norad_id']}
                                     key={index}>#{satellite['norad_id']} {satellite['name']}</MenuItem>;
                })}
            </Select>
        </FormControl>
    );
}

export default SatelliteList;