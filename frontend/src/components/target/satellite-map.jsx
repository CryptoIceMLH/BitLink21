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

import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
    MapContainer,
    TileLayer,
    Marker,
    Polyline,
    Polygon,
    useMapEvents,
} from 'react-leaflet';
import {Box, Fab, Slider, Typography, Tooltip, IconButton} from "@mui/material";
import {SatelliteAlt} from '@mui/icons-material';
import HomeIcon from '@mui/icons-material/Home';
import FullscreenIcon from '@mui/icons-material/Fullscreen';
import FilterCenterFocusIcon from '@mui/icons-material/FilterCenterFocus';
import SettingsIcon from '@mui/icons-material/Settings';
import {useDispatch, useSelector} from "react-redux";
import { useTranslation } from 'react-i18next';
import {
    setOpenMapSettingsDialog,
    setSatGroupId,
    setTerminatorLine,
    setDaySidePolygon,
    setPastOrbitLineColor,
    setFutureOrbitLineColor,
    setSatelliteCoverageColor,
    setOrbitProjectionDuration,
    setTileLayerID,
    setMapZoomLevel,
    setSunPos,
    setMoonPos,
    setGridEditable,
    setSliderTimeOffset,
    setLoading,
    fetchSatellite,
    getTrackingStateFromBackend,
    setSatelliteId,
    setTargetMapSetting,
} from './target-slice.jsx';
import {getTileLayerById} from "../common/tile-layers.jsx";
import {homeIcon, sunIcon, moonIcon, satelliteIcon2} from '../common/dataurl-icons.jsx';
import {
    TitleBar,
    MapStatusBar,
    InternationalDateLinePolyline,
    MapArrowControls,
    SimpleTruncatedHtml,
    getClassNamesBasedOnGridEditing,
    ThemedLeafletTooltip,
    humanizeAltitude,
    humanizeVelocity,
} from "../common/common.jsx";
import MapSettingsIslandDialog from './map-settings-dialog.jsx';
import CoordinateGrid from "../common/mercator-grid.jsx";
import createTerminatorLine from "../common/terminator-line.jsx";
import {getSunMoonCoords} from "../common/sunmoon.jsx";
import {
    satelliteCoverageSelector,
    satelliteDetailsSelector,
    satellitePathsSelector,
    satellitePositionSelector,
    satelliteTrackingStateSelector,
    satelliteTransmittersSelector,
} from "./state-selectors.jsx";
import {useSocket} from "../common/socket.jsx";

const storageMapZoomValueKey = "target-map-zoom-level";

// global leaflet map object
let MapObject = null;

const MapSlider = function ({handleSliderChange}) {
    const marks = [
        {
            value: 0,
            label: '0m',
        },
        {
            value: 15,
            label: '+15',
        },
        {
            value: -15,
            label: '-15',
        },
        {
            value: 30,
            label: '+30m',
        },
        {
            value: -30,
            label: '-30m',
        },
        {
            value: 45,
            label: '+45',
        },
        {
            value: -45,
            label: '-45',
        },
        {
            value: 60,
            label: '+60m',
        },
        {
            value: -60,
            label: '-60m',
        }
    ];

    return (
        <Box sx={{
            width: '100%;',
            bottom: 10,
            position: 'absolute',
            left: '0%',
            zIndex: 400,
            textAlign: 'center',
            opacity: 0.8,
        }}>
            <Slider
                valueLabelDisplay="on"
                marks={marks}
                size="medium"
                track={false}
                aria-label=""
                defaultValue={""}
                onChange={(e, value) => {
                    handleSliderChange(value);
                }}
                min={-60}
                max={60}
                sx={{
                    height: 20,
                    width: '70%',
                }}
            />
        </Box>
    );
};

const CenterHomeButton = React.memo(function CenterHomeButton() {
    const { t } = useTranslation('target');
    const {location} = useSelector(state => state.location);

    const handleClick = () => {
        if (location && location.lat != null && location.lon != null) {
            MapObject.setView([location.lat, location.lon], MapObject.getZoom());
        }
    };

    return (
        <Fab size="small" color="primary" aria-label={t('map_controls.go_home')} onClick={handleClick} disabled={!location}>
            <HomeIcon/>
        </Fab>
    );
});

const CenterMapButton = React.memo(function CenterMapButton() {
    const { t } = useTranslation('target');
    const targetCoordinates = [0, 0];

    const handleClick = () => {
        MapObject.setView(targetCoordinates, MapObject.getZoom());
    };

    return (
        <Fab size="small" color="primary" aria-label={t('map_controls.go_to_center')} onClick={handleClick}>
            <FilterCenterFocusIcon/>
        </Fab>
    );
});

const FullscreenMapButton = React.memo(function FullscreenMapButton() {
    const { t } = useTranslation('target');

    const handleMapFullscreen = () => {
        const mapContainer = MapObject.getContainer();
        if (!document.fullscreenElement) {
            if (mapContainer.requestFullscreen) {
                mapContainer.requestFullscreen();
            } else if (mapContainer.mozRequestFullScreen) {
                mapContainer.mozRequestFullScreen();
            } else if (mapContainer.webkitRequestFullscreen) {
                mapContainer.webkitRequestFullscreen();
            } else if (mapContainer.msRequestFullscreen) {
                mapContainer.msRequestFullscreen();
            }
        } else {
            // Exit fullscreen if we're already in it
            if (document.exitFullscreen) {
                document.exitFullscreen();
            } else if (document.mozCancelFullScreen) {
                document.mozCancelFullScreen();
            } else if (document.webkitExitFullscreen) {
                document.webkitExitFullscreen();
            } else if (document.msExitFullscreen) {
                document.msExitFullscreen();
            }
        }
    };

    return (
        <Fab size="small" color="primary" aria-label={t('map_controls.go_fullscreen')} onClick={handleMapFullscreen}>
            <FullscreenIcon/>
        </Fab>
    );
});

const TargetSatelliteMapContainer = ({}) => {
    const {socket} = useSocket();
    const dispatch = useDispatch();
    const { t } = useTranslation('target');
    const {
        groupId,
        satelliteId: noradId,
        showPastOrbitPath,
        showFutureOrbitPath,
        showSatelliteCoverage,
        showSunIcon,
        showMoonIcon,
        showTerminatorLine,
        showTooltip,
        terminatorLine,
        daySidePolygon,
        pastOrbitLineColor,
        futureOrbitLineColor,
        satelliteCoverageColor,
        orbitProjectionDuration,
        tileLayerID,
        mapZoomLevel,
        sunPos,
        moonPos,
        gridEditable,
        sliderTimeOffset,
        openMapSettingsDialog,
        showGrid,
    } = useSelector(state => state.targetSatTrack);

    const satellitePosition = useSelector(satellitePositionSelector);
    const satelliteCoverage = useSelector(satelliteCoverageSelector);
    const satelliteDetails = useSelector(satelliteDetailsSelector);
    const satelliteTrackingState = useSelector(satelliteTrackingStateSelector);
    const satellitePaths = useSelector(satellitePathsSelector);
    const satelliteTransmitters = useSelector(satelliteTransmittersSelector);
    const {location} = useSelector(state => state.location);
    const [currentPastSatellitesPaths, setCurrentPastSatellitesPaths] = useState([]);
    const [currentFutureSatellitesPaths, setCurrentFutureSatellitesPaths] = useState([]);
    const [currentSatellitesPosition, setCurrentSatellitesPosition] = useState([]);
    const [currentSatellitesCoverage, setCurrentSatellitesCoverage] = useState([]);
    const coverageRef = useRef(null);
    const handleSetMapZoomLevel = useCallback((zoomLevel) => {
        dispatch(setMapZoomLevel(zoomLevel));
    }, [dispatch]);

    // Subscribe to map events
    function MapEventComponent({handleSetMapZoomLevel}) {
        const mapEvents = useMapEvents({
            zoomend: () => {
                const mapZoom = mapEvents.getZoom();
                handleSetMapZoomLevel(mapZoom);
                localStorage.setItem(storageMapZoomValueKey, mapZoom);
            },
        });
        return null;
    }

    useEffect(() => {
        satelliteUpdate(new Date());

        return () => {
        };

    }, [satelliteDetails, satellitePosition, satellitePaths, satelliteCoverage, sliderTimeOffset, showTooltip,
        orbitProjectionDuration, tileLayerID, showPastOrbitPath, showFutureOrbitPath, showSatelliteCoverage,
        showSunIcon, showMoonIcon, showTerminatorLine, pastOrbitLineColor, futureOrbitLineColor,
        satelliteCoverageColor]);

    const satelliteUpdate = function (now) {
        if (Object.keys(satelliteDetails['name']).length !== 0) {

            const satelliteName = satelliteDetails['name'];
            const satelliteId = satelliteDetails['norad_id'];
            const latitude = satellitePosition['lat'];
            const longitude = satellitePosition['lon'];
            const altitude = satellitePosition['alt'];
            const velocity = satellitePosition['vel'];
            const paths = satellitePaths;
            const coverage = satelliteCoverage;

            // generate current positions for the group of satellites
            let currentPos = [];
            let currentCoverage = [];
            let currentFuturePaths = [];
            let currentPastPaths = [];

            // focus map on satellite, center on latitude only
            //let mapCoords = MapObject.getCenter();
            //MapObject.setView([latitude, longitude], MapObject.getZoom());

            if (paths) {
                // past path
                currentPastPaths.push(<Polyline
                    key={`past-path-${noradId}`}
                    positions={paths['past']}
                    pathOptions={{
                        color: pastOrbitLineColor,
                        weight: 2,
                        opacity: 1,
                        smoothFactor: 1,
                    }}
                />)

                // future path
                currentFuturePaths.push(<Polyline
                    key={`future-path-${noradId}`}
                    positions={paths['future']}
                    pathOptions={{
                        color: futureOrbitLineColor,
                        weight: 2,
                        opacity: 0.8,
                        dashArray: "3 3",
                        smoothFactor: 1,
                    }}
                />)
            }

            if (showTooltip) {
                currentPos.push(<Marker key={"marker-" + satelliteId} position={[latitude, longitude]}
                                        icon={satelliteIcon2}>
                    <ThemedLeafletTooltip direction="bottom" offset={[0, 10]} opacity={1} permanent>
                        {satelliteName} - {humanizeAltitude(altitude) + " km, " + humanizeVelocity(velocity) + " km/s"}
                    </ThemedLeafletTooltip>
                </Marker>);
            } else {
                currentPos.push(<Marker key={"marker-" + satelliteId} position={[latitude, longitude]}
                                        icon={satelliteIcon2}>
                </Marker>);
            }

            if (coverage) {
                //let coverage = [];
                //coverage = getSatelliteCoverageCircle(latitude, longitude, altitude, 360);
                currentCoverage.push(<Polyline
                    ref={coverageRef}
                    noClip={true}
                    key={"coverage-" + satelliteDetails['name']}
                    pathOptions={{
                        color: satelliteCoverageColor,
                        weight: 1,
                        fill: true,
                        fillOpacity: 0.2,
                    }}
                    positions={coverage}
                />);
            }

            setCurrentPastSatellitesPaths(currentPastPaths);
            setCurrentFutureSatellitesPaths(currentFuturePaths);
            setCurrentSatellitesPosition(currentPos);
            setCurrentSatellitesCoverage(currentCoverage);

        } else {
            //console.warn("No satellite data found for norad id: ", noradId, satelliteDetails);
        }

        // Day/night boundary
        const terminatorLine = createTerminatorLine().reverse();
        dispatch(setTerminatorLine(terminatorLine));

        // Day side polygon
        const dayPoly = [...terminatorLine];
        dayPoly.push(dayPoly[dayPoly.length - 1]);
        dispatch(setDaySidePolygon(dayPoly));

        // sun and moon position
        const [sunPos, moonPos] = getSunMoonCoords();
        dispatch(setSunPos(sunPos));
        dispatch(setMoonPos(moonPos));
    }

    const handleWhenReady = (map) => {
        // map is ready
        MapObject = map.target;
    };

    useEffect(() => {
        if (coverageRef.current) {
            // Fit the map to the polygon's bounds
            MapObject.fitBounds(coverageRef.current.getBounds(), {
                    padding: [15, 15],
                }
            );
        }
    }, [MapObject, satellitePosition, sliderTimeOffset, noradId]);

    useEffect(() => {
        const intervalId = setInterval(() => {
            if (MapObject) {
                MapObject.invalidateSize();
            }
        }, 1000);

        return () => {
            clearInterval(intervalId);
        };
    }, []);

    useEffect(() => {
        // zoom in and out a bit to fix the zoom factor issue
        if (MapObject) {
            const zoomLevel = MapObject.getZoom();
            const loc = MapObject.getCenter();
            setTimeout(() => {
                MapObject.setView([loc.lat, loc.lng], zoomLevel - 0.25);
                setTimeout(() => {
                    MapObject.setView([loc.lat, loc.lng], zoomLevel);
                }, 500);
            }, 0);
        }
        return () => {

        };
    }, [tileLayerID]);

    useEffect(() => {
        if (noradId) {
            dispatch(fetchSatellite({socket, noradId: noradId}));
        }

        return () => {

        };
    }, [noradId]);

    const handleOpenSettings = useCallback(() => {
        dispatch(setOpenMapSettingsDialog(true));
    }, [dispatch]);

    return (
        <>
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
                            {t('satellite_map.title')}
                        </Typography>
                    </Box>
                    <Box sx={{ display: 'flex', gap: 0.5 }}>
                        <Tooltip title={t('map_settings.title')}>
                            <span>
                                <IconButton
                                    size="small"
                                    onClick={handleOpenSettings}
                                    sx={{ padding: '2px' }}
                                >
                                    <SettingsIcon fontSize="small" />
                                </IconButton>
                            </span>
                        </Tooltip>
                    </Box>
                </Box>
            </TitleBar>
            <MapContainer
                center={satellitePosition?.lat && satellitePosition?.lon ? [satellitePosition.lat, satellitePosition.lon] : [0, 0]}
                zoom={mapZoomLevel}
                style={{width: '100%', height: 'calc(100% - 60px)'}}
                dragging={false}
                scrollWheelZoom={false}
                maxZoom={10}
                minZoom={0}
                whenReady={handleWhenReady}
                zoomSnap={0.25}
                zoomDelta={0.25}
                keyboard={false}
                bounceAtZoomLimits={false}
                closePopupOnClick={false}
            >
                <MapEventComponent handleSetMapZoomLevel={handleSetMapZoomLevel}/>

                <TileLayer url={getTileLayerById(tileLayerID)['url']}/>

                <Box sx={{'& > :not(style)': {m: 1}}} style={{right: 5, top: 5, position: 'absolute'}}>
                    <CenterHomeButton/>
                    <CenterMapButton/>
                    <FullscreenMapButton/>
                </Box>

                <MapSettingsIslandDialog updateBackend={() => {
                    const key = 'target-map-settings';
                    dispatch(setTargetMapSetting({socket, key: key}));
                }}/>

                {sunPos && showSunIcon ? (
                    <Marker position={sunPos} icon={sunIcon} opacity={0.5}/>
                ) : null}

                {moonPos && showMoonIcon ? (
                    <Marker position={moonPos} icon={moonIcon} opacity={0.5}/>
                ) : null}

                {daySidePolygon.length > 1 && showTerminatorLine && (
                    <Polygon
                        positions={daySidePolygon}
                        pathOptions={{
                            fillColor: 'black',
                            fillOpacity: 0.4,
                            color: 'white',
                            opacity: 0.5,
                            weight: 0,
                            smoothFactor: 1,
                        }}
                    />
                )}

                {terminatorLine.length > 1 && showTerminatorLine && (
                    <Polyline
                        positions={terminatorLine}
                        pathOptions={{
                            color: 'white',
                            weight: 1,
                            opacity: 0.1,
                        }}
                    />
                )}

                {InternationalDateLinePolyline()}

                {location && location.lat != null && location.lon != null && (
                    <Marker position={[location.lat, location.lon]} icon={homeIcon} opacity={0.8}/>
                )}

                {showPastOrbitPath ? currentPastSatellitesPaths : null}
                {showFutureOrbitPath ? currentFutureSatellitesPaths : null}
                {currentSatellitesPosition}
                {showSatelliteCoverage ? currentSatellitesCoverage : null}


                <MapArrowControls mapObject={MapObject}/>

                {showGrid && (
                    <CoordinateGrid
                        latInterval={15}
                        lngInterval={15}
                        latColor="#FFFFFF"
                        lngColor="#FFFFFF"
                        weight={1}
                        opacity={0.5}
                        showLabels={false}
                    />
                )}
            </MapContainer>
            <MapStatusBar>
                <SimpleTruncatedHtml
                    className={"attribution"}
                    htmlString={`<a href="https://leafletjs.com" title="A JavaScript library for interactive maps" target="_blank" rel="noopener noreferrer">Leaflet</a> | ${getTileLayerById(tileLayerID)['attribution']}`}
                />
            </MapStatusBar>
        </>
    );
};

export default TargetSatelliteMapContainer;
