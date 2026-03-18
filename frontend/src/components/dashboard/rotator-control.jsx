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

import * as React from "react";
import {useSocket} from "../common/socket.jsx";
import {useDispatch, useSelector} from "react-redux";
import {
    setRotator,
    setTrackingStateInBackend,
    setRotatorConnecting,
    setRotatorDisconnecting,
    sendNudgeCommand,
} from "../target/target-slice.jsx";
import { toast } from "../../utils/toast-with-timestamp.jsx";
import {getClassNamesBasedOnGridEditing, TitleBar} from "../common/common.jsx";
import { useTranslation } from 'react-i18next';
import Grid from "@mui/material/Grid";
import {Button, FormControl, IconButton, InputLabel, MenuItem, Select} from "@mui/material";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import SettingsIcon from '@mui/icons-material/Settings';
import { GaugeAz, GaugeEl } from '../target/rotator-gauges.jsx';
import {
    getCurrentStatusofRotator,
    createTrackingState,
    canControlRotator,
    canStartTracking,
    canStopTracking,
    canConnectRotator,
    isRotatorSelectionDisabled
} from '../target/rotator-utils.js';
import { useNavigate } from 'react-router-dom';


const RotatorControl = React.memo(function RotatorControl() {
    const { socket } = useSocket();
    const dispatch = useDispatch();
    const navigate = useNavigate();
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
        rotatorData,
        gridEditable,
        satelliteData,
        lastRotatorEvent,
        satellitePasses,
        activePass,
        rotatorConnecting,
        rotatorDisconnecting,
    } = useSelector((state) => state.targetSatTrack);

    const { rigs } = useSelector((state) => state.rigs);
    const { rotators } = useSelector((state) => state.rotators);

    const handleTrackingStop = () => {
        const newTrackingState = {...trackingState, 'rotator_state': "stopped"};
        dispatch(setTrackingStateInBackend({socket, data: newTrackingState}));
    };

    const handleTrackingStart = () => {
        const newTrackingState = createTrackingState({
            satelliteId,
            groupId,
            rotatorState: "tracking",
            rigState: trackingState['rig_state'],
            selectedRadioRig,
            selectedRotator,
            selectedTransmitter
        });

        dispatch(setTrackingStateInBackend({socket, data: newTrackingState}))
            .unwrap()
            .then((response) => {

            })
            .catch((error) => {
                toast.error(`${t('rotator_control.failed_start_tracking')}: ${error.message}`);
            });
    };

    function parkRotator() {
        const newTrackingState = createTrackingState({
            satelliteId,
            groupId,
            rotatorState: "parked",
            rigState: trackingState['rig_state'],
            selectedRadioRig,
            selectedRotator,
            selectedTransmitter
        });
        dispatch(setTrackingStateInBackend({socket, data: newTrackingState}))
            .unwrap()
            .then((response) => {

            });
    }

    function connectRotator() {
        const newTrackingState = createTrackingState({
            satelliteId,
            groupId,
            rotatorState: "connected",
            rigState: trackingState['rig_state'],
            selectedRadioRig,
            selectedRotator,
            selectedTransmitter
        });
        dispatch(setTrackingStateInBackend({socket, data: newTrackingState}))
            .unwrap()
            .then((response) => {
                //console.info("Response on setTrackingStateInBackend (connect): ", response);
            })
        .catch((error) => {
            dispatch(setRotatorConnecting(false));
        });
    }

    function disconnectRotator() {
        const newTrackingState = createTrackingState({
            satelliteId,
            groupId,
            rotatorState: "disconnected",
            rigState: trackingState['rig_state'],
            selectedRadioRig,
            selectedRotator,
            selectedTransmitter
        });
        dispatch(setTrackingStateInBackend({socket, data: newTrackingState}))
            .unwrap()
            .then((response) => {
                console.info("Response on setTrackingStateInBackend (disconnect): ", response);
            })
        .catch((error) => {
            dispatch(setRotatorDisconnecting(false));
        });
    }

    function handleRotatorChange(event) {
        dispatch(setRotator(event.target.value));
    }

    function handleNudgeCommand(cmd) {
        dispatch(sendNudgeCommand({socket: socket, cmd: {'cmd': cmd}}));
    }

    return (
        <>
            {/*<TitleBar className={getClassNamesBasedOnGridEditing(gridEditable, ["window-title-bar"])}>Rotator control</TitleBar>*/}
            <Grid container spacing={{ xs: 0, md: 0 }} columns={{ xs: 12, sm: 12, md: 12 }}>

                <Grid size={{ xs: 12, sm: 12, md: 12 }} style={{padding: '0.5rem 0.5rem 0rem 0.5rem'}}>
                    <Grid container direction="row" spacing={1} sx={{ alignItems: 'flex-end' }}>
                        <Grid size="grow">
                            <FormControl disabled={isRotatorSelectionDisabled(trackingState)}
                                         sx={{minWidth: 200, marginTop: 0, marginBottom: 1}} fullWidth variant="outlined" size="small">
                                <InputLabel htmlFor="rotator-select">{t('rotator_control_labels.rotator_label')}</InputLabel>
                                <Select
                                    id="rotator-select"
                                    value={rotators.length > 0? selectedRotator: "none"}
                                    onChange={(event) => {
                                        handleRotatorChange(event);
                                    }}
                                    size="small"
                                    label={t('rotator_control_labels.rotator_label')}>
                                    <MenuItem value="none">
                                        {t('rotator_control_labels.no_rotator_control')}
                                    </MenuItem>
                                    <MenuItem value="" disabled>
                                        <em>{t('rotator_control_labels.select_rotator')}</em>
                                    </MenuItem>
                                    {rotators.map((rotators, index) => {
                                        return <MenuItem value={rotators.id} key={index}>{rotators.name} ({rotators.host}:{rotators.port})</MenuItem>;
                                    })}
                                </Select>
                            </FormControl>
                        </Grid>
                        <Grid>
                            <IconButton
                                onClick={() => navigate('/hardware/rotator')}
                                sx={{
                                    height: '100%',
                                    marginBottom: 1,
                                    borderRadius: 1,
                                    backgroundColor: 'primary.main',
                                    color: 'white',
                                    '&:hover': {
                                        backgroundColor: 'primary.dark',
                                    }
                                }}
                            >
                                <SettingsIcon />
                            </IconButton>
                        </Grid>
                    </Grid>
                </Grid>

                <Grid size={{ xs: 12, sm: 12, md: 12 }} style={{padding: '0rem 0.5rem 0rem 0.5rem'}}>

                    <Grid container direction="row" sx={{
                        justifyContent: "space-between",
                        alignItems: "center",
                    }}>

                    </Grid>

                    <Grid container direction="row" sx={{
                        justifyContent: "space-between",
                        alignItems: "center",
                    }}>
                        <Grid size="grow" style={{textAlign: 'center'}}>
                            <GaugeAz
                                az={rotatorData['az']}
                                limits={[activePass?.['start_azimuth'], activePass?.['end_azimuth']]}
                                peakAz={activePass?.['peak_azimuth']}
                                targetCurrentAz={satelliteData?.['position']['az']}
                                isGeoStationary={activePass?.['is_geostationary']}
                                isGeoSynchronous={activePass?.['is_geosynchronous']}
                                hardwareLimits={[rotatorData['minaz'], rotatorData['maxaz']]}
                            />
                        </Grid>
                        <Grid size="grow" style={{textAlign: 'center'}}>
                            <GaugeEl
                                el={rotatorData['el']}
                                maxElevation={activePass?.['peak_altitude']}
                                targetCurrentEl={satelliteData?.['position']['el']}
                                hardwareLimits={[rotatorData['minel'], rotatorData['maxel']]}
                            />
                        </Grid>

                    </Grid>

                    <Grid container direction="row" sx={{
                        justifyContent: "space-between",
                        alignItems: "stretch",
                    }}>
                        <Grid size="grow" style={{textAlign: 'center'}}>
                            {t('rotator_control.az')} <Typography
                            variant="h5"
                            sx={{
                                fontFamily: "Monospace, monospace",
                                fontWeight: "bold",
                                display: "inline-flex",
                                alignItems: "center",
                                minWidth: "80px",
                                justifyContent: "center"
                            }}
                        >
                            {rotatorData['az'].toFixed(1)}°
                        </Typography>
                        </Grid>
                        <Grid size="grow" style={{textAlign: 'center'}}>
                             {t('rotator_control.el')} <Typography
                            variant="h5"
                            sx={{
                                fontFamily: "Monospace, monospace",
                                fontWeight: "bold",
                                display: "inline-flex",
                                alignItems: "center",
                                minWidth: "80px",
                                justifyContent: "center"
                            }}
                        >
                            {rotatorData['el'].toFixed(1)}°
                        </Typography>
                        </Grid>
                    </Grid>

                    <Grid container direction="row" sx={{
                        justifyContent: "space-between",
                        alignItems: "stretch",
                    }}>
                        <Grid size="grow"
                              style={{paddingRight: '0.5rem', flex: 1, paddingBottom: '0.5rem', paddingTop: '0.2rem'}}
                              container spacing={1} justifyContent="center">
                            <Grid>
                                <Button
                                    size="small"
                                    disabled={!canControlRotator(rotatorData, trackingState)}
                                    fullWidth={true}
                                    variant="contained"
                                    color="primary"
                                    style={{height: '30px', fontSize: '0.9rem', padding: 0}}
                                    onClick={() => {
                                        handleNudgeCommand("nudge_counter_clockwise");
                                    }}>
                                    {t('rotator_control.ccw')}
                                </Button>
                            </Grid>
                            <Grid>
                                <Button
                                    size="small"
                                    disabled={!canControlRotator(rotatorData, trackingState)}
                                    fullWidth={true}
                                    variant="contained"
                                    color="primary"
                                    sx={{}}
                                    style={{height: '30px', fontSize: '0.9rem', padding: 0}}
                                    onClick={() => {
                                        handleNudgeCommand("nudge_clockwise");
                                    }}>
                                    {t('rotator_control.cw')}
                                </Button>
                            </Grid>
                        </Grid>
                        <Grid size="grow"
                              style={{paddingRight: '0rem', flex: 1, paddingBottom: '0.5rem', paddingTop: '0.2rem'}}
                              container
                              spacing={1} justifyContent="center">
                            <Grid>
                                <Button
                                    size="small"
                                    disabled={!canControlRotator(rotatorData, trackingState)}
                                    fullWidth={true}
                                    variant="contained"
                                    color="primary"
                                    style={{height: '30px', fontSize: '0.9rem', padding: 0}}
                                    onClick={() => {
                                        handleNudgeCommand("nudge_up");
                                    }}>
                                    {t('rotator_control.up')}
                                </Button>
                            </Grid>
                            <Grid>
                                <Button
                                    size="small"
                                    disabled={!canControlRotator(rotatorData, trackingState)}
                                    fullWidth={true}
                                    variant="contained"
                                    color="primary"
                                    style={{height: '30px', fontSize: '0.9rem', padding: 0}}
                                    onClick={() => {
                                        handleNudgeCommand("nudge_down");
                                    }}>
                                    {t('rotator_control.down')}
                                </Button>
                            </Grid>
                        </Grid>
                    </Grid>

                    <Grid container direction="row" sx={{
                        justifyContent: "space-between",
                        alignItems: "stretch",
                    }}>
                        <Grid size="grow" style={{textAlign: 'center'}}>
                            <Paper
                                elevation={1}
                                sx={{
                                    height: '30px',
                                    padding: '2px 0px',
                                    backgroundColor: theme => {
                                        const rotatorStatus = getCurrentStatusofRotator(rotatorData, lastRotatorEvent);
                                        return rotatorStatus.bgColor
                                    },
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    borderRadius: '4px',
                                    minWidth: '180px',
                                    width: '100%',
                                }}
                            >
                                <Typography
                                    variant="body2"
                                    sx={{
                                        fontFamily: "Monospace, monospace",
                                        fontWeight: "bold",
                                        color: theme => {
                                            const rotatorStatus = getCurrentStatusofRotator(rotatorData, lastRotatorEvent);
                                            return rotatorStatus.fgColor;
                                        }
                                    }}
                                >
                                    {getCurrentStatusofRotator(rotatorData, lastRotatorEvent).value}
                                </Typography>
                            </Paper>
                        </Grid>

                    </Grid>
                </Grid>

                <Grid size={{ xs: 12, sm: 12, md: 12 }} style={{padding: '0.5rem 0.5rem 0rem 0.5rem'}}>
                    <Grid container direction="row" sx={{
                        justifyContent: "space-between",
                        alignItems: "stretch",
                    }}>
                        <Grid size="grow" style={{paddingRight: '0.5rem', flex: 1}}>
                            <Button
                            loading={rotatorConnecting}
                            disabled={!canConnectRotator(rotatorData, selectedRotator)}
                            fullWidth={true} variant="contained" color="success" style={{height: '40px'}}
                                    onClick={() => {
                                        connectRotator()
                                    }}>
                                {t('rotator_control.connect')}
                            </Button>
                        </Grid>
                        <Grid size="grow" style={{paddingRight: '0.5rem', flex: 1.5}}>
                            <Button
                                loading={rotatorDisconnecting}
                                disabled={["disconnected"].includes(trackingState['rotator_state'])}
                                fullWidth={true}
                                variant="contained" color="error" style={{height: '40px'}}
                                onClick={() => {
                                     disconnectRotator()
                                }}>
                                {t('rotator_control.disconnect')}
                            </Button>
                        </Grid>
                        <Grid size="grow" style={{paddingRight: '0rem', flex: 1}}>
                            <Button disabled={["disconnected"].includes(trackingState['rotator_state'])}
                                    fullWidth={true} variant="contained" color="warning" style={{height: '40px'}}
                                    onClick={() => {
                                        parkRotator()
                                    }}>
                                {t('rotator_control.park')}
                            </Button>
                        </Grid>
                    </Grid>
                </Grid>

                <Grid size={{xs: 12, sm: 12, md: 12}} style={{padding: '0.5rem 0.5rem 0.5rem'}}>
                    <Grid container direction="row" sx={{
                        justifyContent: "space-between",
                        alignItems: "stretch",
                    }}>
                        <Grid size="grow" style={{paddingRight: '0.5rem'}}>
                            <Button fullWidth={true}
                                    disabled={!canStartTracking(trackingState, satelliteId, selectedRotator)}
                                    variant="contained" color="success" style={{height: '60px'}}
                                    onClick={()=>{handleTrackingStart()}}
                            >
                                {t('rotator_control.track')}
                            </Button>
                        </Grid>
                        <Grid size="grow">
                            <Button fullWidth={true}
                                    disabled={!canStopTracking(trackingState, satelliteId, selectedRotator)}
                                    variant="contained" color="error" style={{height: '60px'}}
                                    onClick={() => {handleTrackingStop()}}>
                                {t('rotator_control.stop')}
                            </Button>
                        </Grid>
                    </Grid>
                </Grid>
            </Grid>
        </>
    );
});

export default RotatorControl;