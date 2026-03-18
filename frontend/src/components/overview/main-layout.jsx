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


import React, {useState, useEffect, useRef, useCallback, useMemo} from 'react';
import {Responsive, WidthProvider} from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import 'leaflet/dist/leaflet.css';
import {duration, styled} from "@mui/material/styles";
import OverviewSatelliteGroupSelector from "./satellite-selector.jsx";
import {
    StyledIslandParent,
    StyledIslandParentScrollbar,
    StyledIslandParentNoScrollbar,
} from "../common/common.jsx";
import {toast} from '../../utils/toast-with-timestamp.jsx';
import {useSocket} from "../common/socket.jsx";
import {DataGrid, gridClasses} from "@mui/x-data-grid";
import {useDispatch, useSelector} from "react-redux";
import {useTranslation} from 'react-i18next';
import {
    setGridEditable,
    setMapZoomLevel,
    fetchNextPassesForGroup,
    setShowGeostationarySatellites,
} from './overview-slice.jsx';
import NextPassesGroupIsland from "./satellite-passes.jsx";
import OverviewSatelliteInfoCard from "./satellite-info.jsx";
import {setTrackingStateInBackend} from "../target/target-slice.jsx";
import SatelliteMapContainer from './overview-map.jsx';
import SatelliteDetailsTable from "./satellites-table.jsx";
import SatelliteGroupSelectorBar from "./satellite-group-selector-bar.jsx";
import SatellitePassTimeline from "../target/timeline-main.jsx";

const storageMapZoomValueKey = "overview-map-zoom-level";

// Wrapper component to adapt overview passes to Timeline component
const OverviewTimelineWrapper = React.memo(() => {
    const dispatch = useDispatch();
    const {socket} = useSocket();
    const passes = useSelector((state) => state.overviewSatTrack.passes);
    const gridEditable = useSelector((state) => state.overviewSatTrack.gridEditable);
    const nextPassesHours = useSelector((state) => state.overviewSatTrack.nextPassesHours);
    const passesAreCached = useSelector((state) => state.overviewSatTrack.passesAreCached);
    const passesLoading = useSelector((state) => state.overviewSatTrack.passesLoading);
    const selectedSatGroupId = useSelector((state) => state.overviewSatTrack.selectedSatGroupId);
    const showGeostationarySatellites = useSelector((state) => state.overviewSatTrack.showGeostationarySatellites);
    const passesRangeStart = useSelector((state) => state.overviewSatTrack.passesRangeStart);
    const passesRangeEnd = useSelector((state) => state.overviewSatTrack.passesRangeEnd);

    const handleRefreshPasses = () => {
        if (selectedSatGroupId) {
            dispatch(fetchNextPassesForGroup({
                socket,
                selectedSatGroupId,
                hours: nextPassesHours,
                forceRecalculate: true
            }));
        }
    };

    const handleToggleGeostationary = () => {
        dispatch(setShowGeostationarySatellites(!showGeostationarySatellites));
    };

    return (
        <SatellitePassTimeline
            timeWindowHours={nextPassesHours}
            satelliteName={null} // Multi-satellite view
            passesOverride={passes}
            activePassOverride={null} // Overview doesn't have an active pass concept
            gridEditableOverride={gridEditable}
            cachedOverride={passesAreCached}
            labelType="name" // Show satellite names at peak
            labelVerticalOffset={110} // Labels very close to curve peak
            loading={passesLoading} // Show loading indicator
            nextPassesHours={nextPassesHours} // Pass forecast window for pan boundaries
            onRefresh={handleRefreshPasses}
            showHoverElevation={false} // Hide elevation label on overview page
            showGeoToggle={true} // Show geostationary toggle button on overview
            showGeostationarySatellites={showGeostationarySatellites} // Toggle state from Redux
            onToggleGeostationary={handleToggleGeostationary} // Toggle handler
            highlightActivePasses={true} // Highlight active passes with solid lines
            forceTimeWindowStart={passesRangeStart} // Force timeline to use calculation window start
            forceTimeWindowEnd={passesRangeEnd} // Force timeline to use calculation window end
        />
    );
});

// global callback for dashboard editing here
export let handleSetGridEditableOverview = function () {
};

export const gridLayoutStoreName = 'global-sat-track-layouts';


// load / save layouts from localStorage
function loadLayoutsFromLocalStorage() {
    try {
        const raw = localStorage.getItem(gridLayoutStoreName);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

function saveLayoutsToLocalStorage(layouts) {
    localStorage.setItem(gridLayoutStoreName, JSON.stringify(layouts));
}

const ThemedDiv = styled('div')(({theme}) => ({
    backgroundColor: theme.palette.background.paper,
}));

function getMapZoomFromStorage() {
    const savedZoomLevel = localStorage.getItem(storageMapZoomValueKey);
    return savedZoomLevel ? parseFloat(savedZoomLevel) : 1.4;
}

const GlobalSatelliteTrackLayout = React.memo(function GlobalSatelliteTrackLayout() {
    const {socket} = useSocket();
    const dispatch = useDispatch();
    const {t} = useTranslation('overview');
    const {
        showPastOrbitPath,
        showFutureOrbitPath,
        showSatelliteCoverage,
        showSunIcon,
        showMoonIcon,
        showTerminatorLine,
        showTooltip,
        gridEditable,
        selectedSatellites,
        pastOrbitLineColor,
        futureOrbitLineColor,
        satelliteCoverageColor,
        orbitProjectionDuration,
        tileLayerID,
        mapZoomLevel,
        satelliteGroupId,
        openMapSettingsDialog,
        nextPassesHours,
        showGrid,
        selectedSatelliteId,
        selectedSatGroupId,
    } = useSelector(state => state.overviewSatTrack);
    const {
        trackingState,
        satelliteId: trackingSatelliteId,
        selectedRadioRig,
        selectedRotator,
        selectedTransmitter
    } = useSelector(state => state.targetSatTrack);
    const [currentPastSatellitesPaths, setCurrentPastSatellitesPaths] = useState([]);
    const [currentFutureSatellitesPaths, setCurrentFutureSatellitesPaths] = useState([]);
    const [currentSatellitesPosition, setCurrentSatellitesPosition] = useState([]);
    const [currentSatellitesCoverage, setCurrentSatellitesCoverage] = useState([]);
    const [terminatorLine, setTerminatorLine] = useState([]);
    const [daySidePolygon, setDaySidePolygon] = useState([]);
    const [sunPos, setSunPos] = useState(null);
    const [moonPos, setMoonPos] = useState(null);

    const ResponsiveReactGridLayout = useMemo(() => WidthProvider(Responsive), [gridEditable]);

    // Default layout if none in localStorage
    const defaultLayouts = {
        "lg": [{
            "w": 6,
            "h": 13,
            "x": 0,
            "y": 0,
            "i": "map",
            "moved": false,
            "static": false,
            "resizeHandles": ["se", "ne", "nw", "sw", "s", "e", "w"]
        }, {
            "w": 12,
            "h": 8,
            "x": 0,
            "y": 18,
            "i": "passes",
            "minH": 7,
            "moved": false,
            "static": false,
            "resizeHandles": ["se", "ne", "nw", "sw", "s", "e", "w"]
        }, {
            "w": 2,
            "h": 13,
            "x": 10,
            "y": 0,
            "i": "sat-info",
            "minH": 7,
            "moved": false,
            "static": false,
            "resizeHandles": ["se", "ne", "nw", "sw", "s", "e", "w"]
        }, {"w": 4, "h": 13, "x": 6, "y": 0, "i": "satellite-group", "moved": false, "static": false}, {
            "w": 12,
            "h": 5,
            "x": 0,
            "y": 13,
            "i": "timeline",
            "moved": false,
            "static": false
        }],
        "xs": [{
            "w": 2,
            "h": 17,
            "x": 0,
            "y": 0,
            "i": "map",
            "moved": false,
            "static": false,
            "resizeHandles": ["se", "ne", "nw", "sw", "s", "e", "w"]
        }, {
            "w": 2,
            "h": 8,
            "x": 0,
            "y": 35,
            "i": "passes",
            "minH": 7,
            "moved": false,
            "static": false,
            "resizeHandles": ["se", "ne", "nw", "sw", "s", "e", "w"]
        }, {
            "w": 2,
            "h": 14,
            "x": 0,
            "y": 43,
            "i": "sat-info",
            "minH": 7,
            "moved": false,
            "static": false,
            "resizeHandles": ["se", "ne", "nw", "sw", "s", "e", "w"]
        }, {"w": 2, "h": 12, "x": 0, "y": 23, "i": "satellite-group", "moved": false, "static": false}, {
            "w": 2,
            "h": 6,
            "x": 0,
            "y": 17,
            "i": "timeline",
            "moved": false,
            "static": false
        }],
        "sm": [{
            "w": 6,
            "h": 17,
            "x": 0,
            "y": 0,
            "i": "map",
            "moved": false,
            "static": false,
            "resizeHandles": ["se", "ne", "nw", "sw", "s", "e", "w"]
        }, {
            "w": 6,
            "h": 8,
            "x": 0,
            "y": 32,
            "i": "passes",
            "minH": 7,
            "moved": false,
            "static": false,
            "resizeHandles": ["se", "ne", "nw", "sw", "s", "e", "w"]
        }, {
            "w": 6,
            "h": 12,
            "x": 0,
            "y": 40,
            "i": "sat-info",
            "minH": 7,
            "moved": false,
            "static": false,
            "resizeHandles": ["se", "ne", "nw", "sw", "s", "e", "w"]
        }, {"w": 6, "h": 9, "x": 0, "y": 23, "i": "satellite-group", "moved": false, "static": false}, {
            "w": 6,
            "h": 6,
            "x": 0,
            "y": 17,
            "i": "timeline",
            "moved": false,
            "static": false
        }],
        "xxs": [{
            "w": 2,
            "h": 17,
            "x": 0,
            "y": 0,
            "i": "map",
            "moved": false,
            "static": false,
            "resizeHandles": ["se", "ne", "nw", "sw", "s", "e", "w"]
        }, {
            "w": 2,
            "h": 9,
            "x": 0,
            "y": 23,
            "i": "passes",
            "minH": 7,
            "moved": false,
            "static": false,
            "resizeHandles": ["se", "ne", "nw", "sw", "s", "e", "w"]
        }, {
            "w": 2,
            "h": 14,
            "x": 0,
            "y": 45,
            "i": "sat-info",
            "minH": 7,
            "moved": false,
            "static": false,
            "resizeHandles": ["se", "ne", "nw", "sw", "s", "e", "w"]
        }, {"w": 2, "h": 13, "x": 0, "y": 32, "i": "satellite-group", "moved": false, "static": false}, {
            "w": 2,
            "h": 6,
            "x": 0,
            "y": 17,
            "i": "timeline",
            "moved": false,
            "static": false
        }],
        "md": [{
            "w": 7,
            "h": 17,
            "x": 0,
            "y": 0,
            "i": "map",
            "moved": false,
            "static": false,
            "resizeHandles": ["se", "ne", "nw", "sw", "s", "e", "w"]
        }, {
            "w": 10,
            "h": 8,
            "x": 0,
            "y": 29,
            "i": "passes",
            "minH": 7,
            "moved": false,
            "static": false,
            "resizeHandles": ["se", "ne", "nw", "sw", "s", "e", "w"]
        }, {
            "w": 3,
            "h": 17,
            "x": 7,
            "y": 0,
            "i": "sat-info",
            "minH": 7,
            "moved": false,
            "static": false,
            "resizeHandles": ["se", "ne", "nw", "sw", "s", "e", "w"]
        }, {"w": 10, "h": 7, "x": 0, "y": 22, "i": "satellite-group", "moved": false, "static": false}, {
            "w": 10,
            "h": 5,
            "x": 0,
            "y": 17,
            "i": "timeline",
            "moved": false,
            "static": false
        }]
    };

    // globalize the callback
    handleSetGridEditableOverview = useCallback((value) => {
        dispatch(setGridEditable(value));
    }, [gridEditable]);

    const handleSetMapZoomLevel = useCallback((zoomLevel) => {
        dispatch(setMapZoomLevel(zoomLevel));
    }, [mapZoomLevel]);

    // we load any stored layouts from localStorage or fallback to default
    const [layouts, setLayouts] = useState(() => {
        const loaded = loadLayoutsFromLocalStorage();
        return loaded ?? defaultLayouts;
    });

    const handleSetTrackingOnBackend = (noradId) => {
        const newTrackingState = {
            'norad_id': noradId,
            'group_id': selectedSatGroupId,
            'rotator_state': trackingState['rotator_state'],
            'rig_state': trackingState['rig_state'],
            'rig_id': selectedRadioRig,
            'rotator_id': selectedRotator,
            'transmitter_id': selectedTransmitter,
        };

        dispatch(setTrackingStateInBackend({socket, data: newTrackingState}))
            .unwrap()
            .then((response) => {
                // Success handling
            })
            .catch((error) => {
                toast.error(`${t('satellite_info.failed_tracking')}: ${error.message}`);
            });
    };

    function handleLayoutsChange(currentLayout, allLayouts) {
        setLayouts(allLayouts);
        saveLayoutsToLocalStorage(allLayouts);
    }

    // pre-made ResponsiveGridLayout
    let gridContents = [
        <StyledIslandParent key="map">
            <SatelliteMapContainer handleSetTrackingOnBackend={handleSetTrackingOnBackend}/>
        </StyledIslandParent>,
        <StyledIslandParentNoScrollbar key="passes">
            <NextPassesGroupIsland/>
        </StyledIslandParentNoScrollbar>,
        <StyledIslandParentNoScrollbar key="sat-info">
            <OverviewSatelliteInfoCard/>
        </StyledIslandParentNoScrollbar>,
        <StyledIslandParentNoScrollbar key="satellite-group">
            <SatelliteDetailsTable/>
        </StyledIslandParentNoScrollbar>,
        <StyledIslandParentNoScrollbar key="timeline">
            <OverviewTimelineWrapper/>
        </StyledIslandParentNoScrollbar>,
    ];

    let ResponsiveGridLayoutParent = null;

    if (gridEditable === true) {
        ResponsiveGridLayoutParent =
            <ResponsiveReactGridLayout
                useCSSTransforms={true}
                className="layout"
                layouts={layouts}
                onLayoutChange={handleLayoutsChange}
                breakpoints={{lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0}}
                cols={{lg: 12, md: 10, sm: 6, xs: 2, xxs: 2}}
                rowHeight={30}
                isResizable={true}
                isDraggable={true}
                draggableHandle=".react-grid-draggable"
            >
                {gridContents}
            </ResponsiveReactGridLayout>;
    } else {
        ResponsiveGridLayoutParent =
            <ResponsiveReactGridLayout
                useCSSTransforms={true}
                className="layout"
                layouts={layouts}
                onLayoutChange={handleLayoutsChange}
                breakpoints={{lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0}}
                cols={{lg: 12, md: 10, sm: 6, xs: 2, xxs: 2}}
                rowHeight={30}
                isResizable={false}
                isDraggable={false}
                draggableHandle=".react-grid-draggable"
            >
                {gridContents}
            </ResponsiveReactGridLayout>;
    }

    return (
        <>
            <SatelliteGroupSelectorBar/>
            {ResponsiveGridLayoutParent}
        </>
    );
});

export default GlobalSatelliteTrackLayout;
