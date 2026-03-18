
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


import { useEffect, useState, useCallback, Fragment} from "react";
import {
    Button,
    TextField,
    Divider,
} from "@mui/material";
import Grid from '@mui/material/Grid';
import {getClassNamesBasedOnGridEditing, humanizeFrequency, TitleBar} from "../common/common.jsx";
import * as React from "react";
import {useSocket} from "../common/socket.jsx";
import {useDispatch, useSelector} from "react-redux";
import { useTranslation } from 'react-i18next';
import {
    fetchSatelliteGroups,
    fetchSatellitesByGroupId,
    setSatGroupId,
    setSatelliteId,
    setTrackingStateInBackend,
    setStarting, setAvailableTransmitters,
} from './target-slice.jsx';
import SatelliteList from "./satellite-dropdown.jsx";
import GroupDropdown from "./group-dropdown.jsx";
import { toast } from "../../utils/toast-with-timestamp.jsx";
import Autocomplete from "@mui/material/Autocomplete";
import CircularProgress from "@mui/material/CircularProgress";
import SatelliteSearchAutocomplete from "./satellite-search.jsx";


const SatSelectorIsland = React.memo(function SatSelectorIsland({initialNoradId, initialGroupId}) {
    const { socket } = useSocket();
    const dispatch = useDispatch();
    const { t } = useTranslation('target');
    const {
        satGroups,
        groupId,
        loading,
        error,
        satelliteSelectOpen,
        satelliteGroupSelectOpen,
        groupOfSats,
        trackingState,
        satelliteId,
        uiTrackerDisabled,
        starting,
        selectedRadioRig,
        selectedRotator,
        selectedTransmitter,
        availableTransmitters,
        gridEditable,
        rigData,
        rotatorData,
    } = useSelector((state) => state.targetSatTrack);

    const { rigs } = useSelector((state) => state.rigs);
    const { rotators } = useSelector((state) => state.rotators);

    useEffect(() => {
        dispatch(fetchSatelliteGroups({ socket }));
    }, [dispatch, socket]);

    useEffect(() => {
        if (satGroups.some(group => group.id === initialGroupId)) {
            fetchSatellitesByGroupId(initialGroupId);
        }

        return () => {

        };
    }, [satGroups]);

    useEffect(() => {
        // If the known group list includes initialGroupId, set it and fetch group satellites
        if (satGroups.some((group) => group.id === initialGroupId)) {
            dispatch(setSatGroupId(initialGroupId));
            dispatch(
                fetchSatellitesByGroupId({
                    socket,
                    groupId: groupId,
                })
            );
            // Optionally set it in Redux right away
            if (initialNoradId) {
                dispatch(setSatelliteId(initialNoradId));
            }
        }
    }, [satGroups, initialGroupId, initialNoradId, dispatch, socket]);

    useEffect(() => {
        dispatch(setStarting(false));
        return () => {

        };
    }, []);

    const handleTrackingStop = () => {
        const newTrackingState = {
            ...trackingState,
            'rotator_state': "stopped",
            'rig_state': "stopped",
        };
        dispatch(setTrackingStateInBackend({socket, data: newTrackingState}));
    };

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

    const handleSatelliteSelect = useCallback((satellite) => {
        dispatch(setSatelliteId(satellite.norad_id));
        dispatch(setAvailableTransmitters(getTransmittersForSatelliteId(satellite.norad_id)));

        // set the tracking state in the backend to the new norad id and leave the state as is
        const data = {
            ...trackingState,
            norad_id: satellite.norad_id,
            group_id: satellite.groups[0].id,
            rig_id: selectedRadioRig,
            rotator_id: selectedRotator,
            transmitter_id: selectedTransmitter,
        };
        dispatch(setTrackingStateInBackend({ socket, data: data}));

    }, [dispatch]);

    return (
        <>
            <Grid container spacing={0} columns={12}>
                <Grid size={12}>
                    <Grid size={12} style={{padding: '0rem 0rem 0.5rem 0rem'}}>
                        <SatelliteSearchAutocomplete onSatelliteSelect={handleSatelliteSelect} />
                    </Grid>
                </Grid>
                <Grid size={12}>
                    <Grid container spacing={1} columns={12}>
                        <Grid size={8}>
                            <Grid size={12} style={{padding: '0rem 0rem 0rem 0rem'}}>
                                <GroupDropdown />
                            </Grid>
                            <Grid
                                size={12}
                                style={{ padding: '0.5rem 0rem 0rem 0rem' }}
                            >
                                <SatelliteList/>
                            </Grid>
                        </Grid>

                        <Grid
                            size={4}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                height: '100%',
                                paddingTop: '0rem',
                                paddingBottom: '0rem',
                                paddingLeft: '0rem',
                                paddingRight: '0rem',
                            }}
                        >
                            <Button
                                variant="contained"
                                color="error"
                                disabled={rigData['tracking'] !== true && rotatorData['tracking'] !== true}
                                size="large"
                                onClick={handleTrackingStop}
                                sx={{
                                    width: '100%',
                                    fontSize: '0.8rem',
                                    minHeight: '60px',
                                    height: 'calc(80px + 0.5rem)',
                                    whiteSpace: 'normal',
                                    wordBreak: 'break-word',
                                    lineHeight: 1.2,
                                    padding: '8px',
                                }}
                            >
                                {t('satellite_selector.stop_tracking')}
                            </Button>
                        </Grid>
                    </Grid>
                </Grid>
            </Grid>
        </>
    );
});

export default SatSelectorIsland;