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
import {useEffect} from "react";
import {
    fetchSatelliteGroups,
    fetchSatellitesByGroupId,
    setGroupOfSats,
    setRadioRig,
    setRotator,
    setRigVFO,
    setVFO1,
    setVFO2,
    setSatelliteGroupSelectOpen,
    setSatelliteId,
    setSatGroupId,
    setSelectedTransmitter,
    setStarting,
    setTrackingStateInBackend
} from "../target/target-slice.jsx";
import { toast } from "../../utils/toast-with-timestamp.jsx";
import { useTranslation } from 'react-i18next';
import {
    getClassNamesBasedOnGridEditing,
    getFrequencyBand,
    humanizeFrequency,
    preciseHumanizeFrequency,
    TitleBar
} from "../common/common.jsx";
import Grid from "@mui/material/Grid";
import {Box, Button, Divider, FormControl, IconButton, InputLabel, ListSubheader, MenuItem, Select} from "@mui/material";
import SwapVertIcon from '@mui/icons-material/SwapVert';
import SatelliteList from "../target/satellite-dropdown.jsx";
import Typography from "@mui/material/Typography";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import {setCenterFrequency} from "../waterfall/waterfall-slice.jsx";
import LCDFrequencyDisplay from "../common/lcd-frequency-display.jsx";
import SettingsIcon from '@mui/icons-material/Settings';
import { useNavigate } from 'react-router-dom';


const RigControl = React.memo(function RigControl() {
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
        selectedRigVFO,
        selectedVFO1,
        selectedVFO2,
        selectedTransmitter,
        availableTransmitters,
        rigData,
    } = useSelector((state) => state.targetSatTrack);

    // Safeguard: Reset VFO if hardware rig is selected with VFO 3 or 4
    React.useEffect(() => {
        const rigType = determineRadioType(selectedRadioRig);
        if (rigType === "rig" && (selectedRigVFO === "3" || selectedRigVFO === "4")) {
            dispatch(setRigVFO("none"));
        }
    }, [selectedRadioRig, selectedRigVFO, dispatch]);

    const {
        selectedSDRId,
        gridEditable,
    } = useSelector((state) => state.waterfall);

    const {
        sdrs
    } = useSelector((state) => state.sdrs);

    const {
        rigs
    } = useSelector((state) => state.rigs);

    const groupedTransmitters = React.useMemo(() => {
        const groups = {};

        availableTransmitters.forEach((tx) => {
            const referenceFrequency = tx.downlink_observed_freq || tx.downlink_low;
            const band = getFrequencyBand(referenceFrequency);
            if (!groups[band]) {
                groups[band] = [];
            }
            groups[band].push(tx);
        });

        const bandOrder = ['VHF', 'UHF', 'L-band', 'S-band', 'C-band', 'X-band', 'Ku-band', 'K-band', 'Ka-band'];
        const sortedBands = Object.keys(groups).sort((a, b) => {
            const aIndex = bandOrder.indexOf(a);
            const bIndex = bandOrder.indexOf(b);
            if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
            if (aIndex !== -1) return -1;
            if (bIndex !== -1) return 1;
            return a.localeCompare(b);
        });

        return sortedBands.map((band) => ({ band, transmitters: groups[band] }));
    }, [availableTransmitters]);

    const handleTrackingStop = () => {
        const newTrackingState = {
            ...trackingState,
            'rig_state': "stopped",
            'vfo1': selectedVFO1,
            'vfo2': selectedVFO2,
        };
        dispatch(setTrackingStateInBackend({socket, data: newTrackingState}));
    };

    function getConnectionStatusofRig() {
        if (rigData['connected'] === true) {
            return t('rig_control.connected');
        } else  if (rigData['connected'] === false) {
            return t('rig_control.not_connected');
        } else {
            return t('rig_control.unknown');
        }
    }

    const handleTrackingStart = () => {
        const newTrackingState = {
            'norad_id': satelliteId,
            'group_id': groupId,
            'rotator_state': trackingState['rotator_state'],
            'rig_state': 'tracking',
            'rig_id': selectedRadioRig,
            'rotator_id': selectedRotator,
            'transmitter_id': selectedTransmitter,
            'rig_vfo': selectedRigVFO,
            'vfo1': selectedVFO1,
            'vfo2': selectedVFO2,
        };

        dispatch(setTrackingStateInBackend({socket, data: newTrackingState}))
            .unwrap()
            .then((response) => {

            })
            .catch((error) => {
                toast.error(`${t('rig_control.failed_start_tracking')}: ${error.message}`);
            });
    };

    function determineRadioType(selectedRadioRigOrSDR) {
        let selectedType = "unknown";

        // Check if it's a rig
        const selectedRig = rigs.find(rig => rig.id === selectedRadioRigOrSDR);
        if (selectedRig) {
            selectedType = "rig";
        }

        // Check if it's an SDR
        const selectedSDR = sdrs.find(sdr => sdr.id === selectedRadioRigOrSDR);
        if (selectedSDR) {
            selectedType = "sdr";
        }

        return selectedType;
    }

    function handleRigChange(event) {
        // Find the selected MenuItem to get its type
        const selectedValue = event.target.value;
        const selectedType = determineRadioType(selectedValue);

        // Set the selected radio rig
        dispatch(setRadioRig(selectedValue));

        // Reset VFO selection when changing rigs
        dispatch(setRigVFO("none"));
    }

    function handleTransmitterChange(event) {
        const transmitterId = event.target.value;
        dispatch(setSelectedTransmitter(transmitterId));

        const data = {
            ...trackingState,
            'norad_id': satelliteId,
            'rotator_state': trackingState['rotator_state'],
            'rig_state': trackingState['rig_state'],
            'group_id': groupId,
            'rig_id': selectedRadioRig,
            'rotator_id': selectedRotator,
            'transmitter_id': event.target.value,
            'rig_vfo': selectedRigVFO,
            'vfo1': selectedVFO1,
            'vfo2': selectedVFO2,
        };

        dispatch(setTrackingStateInBackend({ socket: socket, data: data}))
            .unwrap()
            .then((response) => {

            })
            .catch((error) => {

            });
    }

    function handleRigVFOChange(event) {
        const vfoValue = event.target.value;
        dispatch(setRigVFO(vfoValue));

        const data = {
            ...trackingState,
            'norad_id': satelliteId,
            'rotator_state': trackingState['rotator_state'],
            'rig_state': trackingState['rig_state'],
            'group_id': groupId,
            'rig_id': selectedRadioRig,
            'rotator_id': selectedRotator,
            'transmitter_id': selectedTransmitter,
            'rig_vfo': event.target.value,
            'vfo1': selectedVFO1,
            'vfo2': selectedVFO2,
        };

        dispatch(setTrackingStateInBackend({ socket: socket, data: data}))
            .unwrap()
            .then((response) => {

            })
            .catch((error) => {

            });
    }

    function handleVFO1Change(event) {
        const vfo1Value = event.target.value;
        dispatch(setVFO1(vfo1Value));

        const data = {
            ...trackingState,
            'norad_id': satelliteId,
            'rotator_state': trackingState['rotator_state'],
            'rig_state': trackingState['rig_state'],
            'group_id': groupId,
            'rig_id': selectedRadioRig,
            'rotator_id': selectedRotator,
            'transmitter_id': selectedTransmitter,
            'rig_vfo': selectedRigVFO,
            'vfo1': vfo1Value,
            'vfo2': selectedVFO2,
        };

        dispatch(setTrackingStateInBackend({ socket: socket, data: data}))
            .unwrap()
            .then((response) => {

            })
            .catch((error) => {

            });
    }

    function handleVFO2Change(event) {
        const vfo2Value = event.target.value;
        dispatch(setVFO2(vfo2Value));

        const data = {
            ...trackingState,
            'norad_id': satelliteId,
            'rotator_state': trackingState['rotator_state'],
            'rig_state': trackingState['rig_state'],
            'group_id': groupId,
            'rig_id': selectedRadioRig,
            'rotator_id': selectedRotator,
            'transmitter_id': selectedTransmitter,
            'rig_vfo': selectedRigVFO,
            'vfo1': selectedVFO1,
            'vfo2': vfo2Value,
        };

        dispatch(setTrackingStateInBackend({ socket: socket, data: data}))
            .unwrap()
            .then((response) => {

            })
            .catch((error) => {

            });
    }

    function handleVFOSwap() {
        // Swap VFO1 and VFO2 values
        const tempVFO1 = selectedVFO1;
        const tempVFO2 = selectedVFO2;

        dispatch(setVFO1(tempVFO2));
        dispatch(setVFO2(tempVFO1));

        const data = {
            ...trackingState,
            'norad_id': satelliteId,
            'rotator_state': trackingState['rotator_state'],
            'rig_state': trackingState['rig_state'],
            'group_id': groupId,
            'rig_id': selectedRadioRig,
            'rotator_id': selectedRotator,
            'transmitter_id': selectedTransmitter,
            'rig_vfo': selectedRigVFO,
            'vfo1': tempVFO2,
            'vfo2': tempVFO1,
        };

        dispatch(setTrackingStateInBackend({ socket: socket, data: data}))
            .unwrap()
            .then((response) => {

            })
            .catch((error) => {

            });
    }

    function connectRig() {
        const data = {
            ...trackingState,
            'rig_state': "connected",
            'rig_id': selectedRadioRig,
            'rig_vfo': selectedRigVFO,
            'vfo1': selectedVFO1,
            'vfo2': selectedVFO2,
        };
        dispatch(setTrackingStateInBackend({ socket, data: data}));
    }

    function disconnectRig() {
        const data = {
            ...trackingState,
            'rig_state': "disconnected",
            'rig_id': selectedRadioRig,
            'rig_vfo': selectedRigVFO,
            'vfo1': selectedVFO1,
            'vfo2': selectedVFO2,
        };
        dispatch(setTrackingStateInBackend({ socket, data: data}));
    }

    return (
        <>
            {/*<TitleBar className={getClassNamesBasedOnGridEditing(gridEditable, ["window-title-bar"])}>Radio rig control</TitleBar>*/}

            <Grid container spacing={{ xs: 0, md: 0 }} columns={{ xs: 12, sm: 12, md: 12 }}>
                {/* 1. Rig Selection */}
                <Grid size={{ xs: 12, sm: 12, md: 12 }} style={{padding: '0.5rem 0.5rem 0rem 0.5rem'}}>
                    <Grid container direction="row" spacing={1} sx={{ alignItems: 'flex-end' }}>
                        <Grid size="grow">
                            <FormControl disabled={rigData['connected'] === true}
                                         sx={{minWidth: 200, marginTop: 0, marginBottom: 1}} fullWidth variant="outlined" size="small">
                                <InputLabel htmlFor="radiorig-select">{t('rig_control_labels.rig_label')}</InputLabel>
                                <Select
                                    id="radiorig-select"
                                    value={rigs.length > 0? selectedRadioRig: "none"}
                                    onChange={(event) => {
                                        handleRigChange(event);
                                    }}
                                    size="small"
                                    label={t('rig_control_labels.rig_label')}>
                                    <MenuItem value="none">
                                        {t('rig_control_labels.no_rig_control')}
                                    </MenuItem>
                                    <MenuItem value="" disabled>
                                        <em>{t('rig_control_labels.select_rig')}</em>
                                    </MenuItem>
                                    {rigs.map((rig, index) => {
                                        return <MenuItem type={"rig"} value={rig.id} key={index}>{rig.name} ({rig.host}:{rig.port})</MenuItem>;
                                    })}
                                </Select>
                            </FormControl>
                        </Grid>
                        <Grid>
                            <IconButton
                                onClick={() => navigate('/hardware/rig')}
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

                {/* 2. Transmitter Selection */}
                <Grid size={{xs: 12, sm: 12, md: 12}} style={{padding: '0rem 0.5rem 0rem 0.5rem'}}>
                    <FormControl disabled={rigData['tracking'] === true}
                                 sx={{minWidth: 200, marginTop: 0, marginBottom: 1}} fullWidth variant="outlined" size="small">
                        <InputLabel htmlFor="transmitter-select">{t('rig_control_labels.transmitter_label')}</InputLabel>
                        <Select
                            id="transmitter-select"
                            value={availableTransmitters.length > 0 && availableTransmitters.some(t => t.id === selectedTransmitter) ? selectedTransmitter : "none"}
                            onChange={(event) => {
                                handleTransmitterChange(event);
                            }}
                            size="small"
                            label={t('rig_control_labels.transmitter_label')}>
                            <MenuItem value="none">
                                {t('rig_control_labels.no_frequency_control')}
                            </MenuItem>
                            {availableTransmitters.length === 0 && (
                                <MenuItem value="" disabled>
                                    <em>{t('rig_control_labels.no_transmitters')}</em>
                                </MenuItem>
                            )}
                            {groupedTransmitters.map(({ band, transmitters }) => [
                                <ListSubheader
                                    key={`header-${band}`}
                                    sx={{ fontSize: '0.75rem', fontWeight: 'bold', lineHeight: '32px' }}
                                >
                                    {band}
                                </ListSubheader>,
                                ...transmitters.map((transmitter) => (
                                    <MenuItem value={transmitter.id} key={transmitter.id} sx={{ pl: 3 }}>
                                        <Box sx={{display: 'flex', alignItems: 'center', gap: 1}}>
                                            <Box
                                                sx={{
                                                    width: 8,
                                                    height: 8,
                                                    borderRadius: '50%',
                                                    backgroundColor: transmitter.alive ? 'success.main' : 'error.main',
                                                    boxShadow: (theme) => transmitter.alive
                                                        ? `0 0 6px ${theme.palette.success.main}99`
                                                        : `0 0 6px ${theme.palette.error.main}99`,
                                                }}
                                            />
                                            <Box sx={{ display: 'flex', flexDirection: 'column' }}>
                                                <Typography variant="body2">
                                                    {transmitter['description']} ({humanizeFrequency(transmitter['downlink_low'])})
                                                </Typography>
                                                <Typography variant="caption" color="text.secondary">
                                                    Source: {transmitter.source || 'Unknown'}
                                                </Typography>
                                            </Box>
                                        </Box>
                                    </MenuItem>
                                ))
                            ])}
                        </Select>
                    </FormControl>
                </Grid>

                {/* 3 & 4. VFO Selection with Swap Button */}
                <Grid size={{ xs: 12, sm: 12, md: 12 }} style={{padding: '0rem 0.5rem 0rem 0.5rem'}}>
                    <Box sx={{ display: 'flex', gap: 1, alignItems: 'stretch' }}>
                        {/* VFO dropdowns container */}
                        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 1 }}>
                            {/* VFO 1 */}
                            <FormControl disabled={rigData['tracking'] === true}
                                         sx={{marginTop: 0, marginBottom: 0}} fullWidth variant="outlined" size="small">
                                <InputLabel htmlFor="vfo1-select">VFO 1</InputLabel>
                                <Select
                                    id="vfo1-select"
                                    value={selectedTransmitter === "none" ? "none" : (selectedVFO1 || "uplink")}
                                    onChange={(event) => {
                                        handleVFO1Change(event);
                                    }}
                                    size="small"
                                    label="VFO 1">
                                    <MenuItem value="none">[none]</MenuItem>
                                    <MenuItem value="uplink">
                                        {selectedTransmitter && selectedTransmitter !== "none" && rigData?.transmitters?.length > 0 ? (
                                            (() => {
                                                const transmitter = rigData.transmitters.find(t => t.id === selectedTransmitter);
                                                return transmitter ? (
                                                    <>Uplink: {preciseHumanizeFrequency(transmitter.uplink_observed_freq || 0)}</>
                                                ) : "Uplink";
                                            })()
                                        ) : "Uplink"}
                                    </MenuItem>
                                    <MenuItem value="downlink">
                                        {selectedTransmitter && selectedTransmitter !== "none" && rigData?.transmitters?.length > 0 ? (
                                            (() => {
                                                const transmitter = rigData.transmitters.find(t => t.id === selectedTransmitter);
                                                return transmitter ? (
                                                    <>Downlink: {preciseHumanizeFrequency(transmitter.downlink_observed_freq || 0)}</>
                                                ) : "Downlink";
                                            })()
                                        ) : "Downlink"}
                                    </MenuItem>
                                </Select>
                            </FormControl>

                            {/* VFO 2 */}
                            <FormControl disabled={rigData['tracking'] === true}
                                         sx={{marginTop: 0, marginBottom: 1}} fullWidth variant="outlined" size="small">
                                <InputLabel htmlFor="vfo2-select">VFO 2</InputLabel>
                                <Select
                                    id="vfo2-select"
                                    value={selectedTransmitter === "none" ? "none" : (selectedVFO2 || "downlink")}
                                    onChange={(event) => {
                                        handleVFO2Change(event);
                                    }}
                                    size="small"
                                    label="VFO 2">
                                    <MenuItem value="none">[none]</MenuItem>
                                    <MenuItem value="downlink">
                                        {selectedTransmitter && selectedTransmitter !== "none" && rigData?.transmitters?.length > 0 ? (
                                            (() => {
                                                const transmitter = rigData.transmitters.find(t => t.id === selectedTransmitter);
                                                return transmitter ? (
                                                    <>Downlink: {preciseHumanizeFrequency(transmitter.downlink_observed_freq || 0)}</>
                                                ) : "Downlink";
                                            })()
                                        ) : "Downlink"}
                                    </MenuItem>
                                    <MenuItem value="uplink">
                                        {selectedTransmitter && selectedTransmitter !== "none" && rigData?.transmitters?.length > 0 ? (
                                            (() => {
                                                const transmitter = rigData.transmitters.find(t => t.id === selectedTransmitter);
                                                return transmitter ? (
                                                    <>Uplink: {preciseHumanizeFrequency(transmitter.uplink_observed_freq || 0)}</>
                                                ) : "Uplink";
                                            })()
                                        ) : "Uplink"}
                                    </MenuItem>
                                </Select>
                            </FormControl>
                        </Box>

                        {/* Swap button - takes remaining space vertically */}
                        <Box sx={{ display: 'flex', alignItems: 'stretch', flexShrink: 0 }}>
                            <IconButton
                                onClick={handleVFOSwap}
                                disabled={rigData['tracking'] === true}
                                sx={{
                                    height: 'calc(100% - 5px)',
                                    borderRadius: 1,
                                    px: 1,
                                    bgcolor: 'primary.main',
                                    color: 'primary.contrastText',
                                    '&:hover': {
                                        bgcolor: 'primary.dark',
                                    },
                                    '&:disabled': {
                                        bgcolor: 'action.disabledBackground',
                                        color: 'action.disabled',
                                    }
                                }}
                                title="Swap VFO 1 and VFO 2">
                                <SwapVertIcon />
                            </IconButton>
                        </Box>
                    </Box>
                </Grid>


                <Grid size={{xs: 12, sm: 12, md: 12}} sx={{height: '135px', overflow: 'auto', pt: 1.5}}>
                    <Grid size={{xs: 12, sm: 12, md: 12}} style={{padding: '0rem 0.5rem 0rem 0.5rem'}}>
                        <Grid container direction="column" spacing={1}>
                            {/* VFO 1 Frequency */}
                            <Grid>
                                <Grid container direction="row" sx={{alignItems: "center", gap: 0}}>
                                    <Grid size="auto" style={{minWidth: '100px'}}>
                                        <Typography variant="body2" sx={{color: 'text.secondary'}}>
                                            VFO 1
                                        </Typography>
                                    </Grid>
                                    <Grid size="grow" style={{textAlign: 'right'}}>
                                        <Typography variant="h7" style={{fontFamily: "Monospace, monospace", fontWeight: "bold"}}>
                                            <LCDFrequencyDisplay frequency={rigData?.vfo1?.frequency || 0} size="medium" />
                                        </Typography>
                                    </Grid>
                                </Grid>
                            </Grid>

                            {/* VFO 2 Frequency */}
                            <Grid>
                                <Grid container direction="row" sx={{alignItems: "center", gap: 0}}>
                                    <Grid size="auto" style={{minWidth: '100px'}}>
                                        <Typography variant="body2" sx={{color: 'text.secondary'}}>
                                            VFO 2
                                        </Typography>
                                    </Grid>
                                    <Grid size="grow" style={{textAlign: 'right'}}>
                                        <Typography variant="h7" style={{fontFamily: "Monospace, monospace", fontWeight: "bold"}}>
                                            <LCDFrequencyDisplay frequency={rigData?.vfo2?.frequency || 0} size="medium" />
                                        </Typography>
                                    </Grid>
                                </Grid>
                            </Grid>

                            {/* Doppler Shift */}
                            <Grid>
                                <Grid container direction="row" sx={{alignItems: "center", gap: 0}}>
                                    <Grid size="auto" style={{minWidth: '100px'}}>
                                        <Typography variant="body2" sx={{color: 'text.secondary'}}>
                                            {t('rig_control.doppler_shift')}
                                        </Typography>
                                    </Grid>
                                    <Grid size="grow" style={{textAlign: 'right'}}>
                                        <Typography variant="h7" style={{fontFamily: "Monospace, monospace", fontWeight: "bold"}}>
                                            <LCDFrequencyDisplay frequency={rigData['doppler_shift']} size="medium" frequencyIsOffset={true}/>
                                        </Typography>
                                    </Grid>
                                </Grid>
                            </Grid>
                        </Grid>
                    </Grid>
                </Grid>

                <Grid size={{ xs: 12, sm: 12, md: 12 }} style={{padding: '0.5rem 0.5rem 0rem 0.5rem'}}>
                    <Grid container direction="row" sx={{
                        justifyContent: "space-between",
                        alignItems: "stretch",
                    }}>
                        <Grid size="grow" style={{paddingRight: '0.5rem', flex: 1}}>
                            <Button disabled={
                                ["tracking", "connected", "stopped"].includes(trackingState['rig_state']) ||
                                ["none", ""].includes(selectedRotator) ||
                                ["none", ""].includes(selectedRadioRig)
                            } fullWidth={true} variant="contained" color="success" style={{height: '50px'}}
                                    onClick={() => {
                                        connectRig()
                                    }}>
                                {t('rig_control.connect')}
                            </Button>
                        </Grid>
                        <Grid size="grow" style={{paddingRight: '0rem', flex: 1}}>
                            <Button disabled={["disconnected"].includes(trackingState['rig_state'])}
                                    fullWidth={true}
                                    variant="contained" color="error" style={{height: '50px'}}
                                    onClick={() => {
                                        disconnectRig()
                                    }}>
                                {t('rig_control.disconnect')}
                            </Button>
                        </Grid>
                    </Grid>
                </Grid>

                <Grid size={{ xs: 12, sm: 12, md: 12 }} style={{padding: '0.5rem 0.5rem 0.5rem'}}>
                    <Grid container direction="row" sx={{
                        justifyContent: "space-between",
                        alignItems: "stretch",
                    }}>
                        <Grid size="grow" style={{paddingRight: '0.5rem'}}>
                                <Button fullWidth={true} disabled={
                                    trackingState['rig_state'] === "tracking" || trackingState['rig_state'] === "disconnected" ||
                                    satelliteId === "" ||
                                    ["none", ""].includes(selectedRadioRig)
                                    || ["none", ""].includes(selectedTransmitter)
                                }
                                    variant="contained" color="success" style={{height: '60px'}}
                                    onClick={()=>{handleTrackingStart()}}
                            >
                                {t('rig_control.track_radio')}
                            </Button>
                        </Grid>
                        <Grid size="grow">
                            <Button fullWidth={true}
                                    disabled={
                                ["stopped", "disconnected", "connected"].includes(trackingState['rig_state']) ||
                                        satelliteId === "" || ["none", ""].includes(selectedRadioRig)}
                                    variant="contained" color="error" style={{height: '60px'}}
                                    onClick={() => {handleTrackingStop()}}>
                                {t('rig_control.stop')}
                            </Button>
                        </Grid>
                    </Grid>
                </Grid>
            </Grid>
        </>
    );
});

export default RigControl;
