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
import 'leaflet-fullscreen/dist/Leaflet.fullscreen.js';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import 'leaflet/dist/leaflet.css';
import {
    StyledIslandParentScrollbar,
} from "../common/common.jsx";
import {
    setGridEditable
} from './waterfall-slice.jsx';
import {useSocket} from "../common/socket.jsx";
import {useDispatch, useSelector} from "react-redux";
import MainWaterfallDisplay from "./waterfall-island.jsx";
import WaterfallSettings from "./settings-column.jsx";
import TranscriptionSubtitles from "./transcription-subtitles.jsx";


// A global callback for dashboard editing here
export let handleSetGridEditableWaterfall = function () {
};

export const gridLayoutStoreName = 'waterfall-view-layouts';

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

const MainLayout = React.memo(function MainLayout() {
    const waterfallComponentSettingsRef = useRef(null);

    // Playback timing refs shared between waterfall and settings components
    const playbackElapsedSecondsRef = useRef(null);
    const playbackRemainingSecondsRef = useRef(null);
    const playbackTotalSecondsRef = useRef(null);

    const {socket} = useSocket();
    const dispatch = useDispatch();
    const {
        gridEditable,
    } = useSelector(state => state.waterfall);

    const ResponsiveReactGridLayout = useMemo(() => WidthProvider(Responsive), [gridEditable]);

    // Default layout if none in localStorage
    const defaultLayouts = {
        "lg": [{
            "w": 10,
            "h": 25,
            "x": 0,
            "y": 0,
            "i": "waterfall",
            "moved": false,
            "static": false
        }, {"w": 2, "h": 25, "x": 10, "y": 0, "i": "settings", "moved": false, "static": false}],
        "md": [{"w": 10, "h": 22, "x": 0, "y": 0, "i": "waterfall", "moved": false, "static": false}, {
            "w": 10,
            "h": 13,
            "x": 0,
            "y": 22,
            "i": "settings",
            "moved": false,
            "static": false
        }],
        "sm": [{"w": 6, "h": 22, "x": 0, "y": 0, "i": "waterfall", "moved": false, "static": false}, {
            "w": 6,
            "h": 14,
            "x": 0,
            "y": 22,
            "i": "settings",
            "moved": false,
            "static": false
        }],
        "xs": [{"w": 2, "h": 22, "x": 0, "y": 0, "i": "waterfall", "moved": false, "static": false}, {
            "w": 2,
            "h": 13,
            "x": 0,
            "y": 22,
            "i": "settings",
            "moved": false,
            "static": false
        }],
        "xxs": [{"w": 2, "h": 22, "x": 0, "y": 13, "i": "waterfall", "moved": false, "static": false}, {
            "w": 2,
            "h": 13,
            "x": 0,
            "y": 0,
            "i": "settings",
            "moved": false,
            "static": false
        }, {"w": 2, "h": 9, "x": 0, "y": 35, "i": "rig-control", "moved": false, "static": false}]
    };

    // globalize the callback
    handleSetGridEditableWaterfall = useCallback((value) => {
        dispatch(setGridEditable(value));
    }, [gridEditable]);


    // we load any stored layouts from localStorage or fallback to default
    const [layouts, setLayouts] = useState(() => {
        const loaded = loadLayoutsFromLocalStorage();
        return loaded ?? defaultLayouts;
    });

    function handleLayoutsChange(currentLayout, allLayouts) {
        setLayouts(allLayouts);
        saveLayoutsToLocalStorage(allLayouts);
    }

    // pre-made ResponsiveGridLayout
    let gridContents = [
        <StyledIslandParentScrollbar key="waterfall">
            <MainWaterfallDisplay
                playbackElapsedSecondsRef={playbackElapsedSecondsRef}
                playbackRemainingSecondsRef={playbackRemainingSecondsRef}
                playbackTotalSecondsRef={playbackTotalSecondsRef}
            />
        </StyledIslandParentScrollbar>,
        <StyledIslandParentScrollbar key="settings">
            <WaterfallSettings
                ref={waterfallComponentSettingsRef}
                playbackRemainingSecondsRef={playbackRemainingSecondsRef}
            />
        </StyledIslandParentScrollbar>,
        // <StyledIslandParentScrollbar key="rig-control">
        //     <ControllerTabs />
        // </StyledIslandParentScrollbar>,
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
            {ResponsiveGridLayoutParent}

            {/* Transcription Subtitles Overlay - positioned over entire page */}
            <TranscriptionSubtitles
                maxLines={4}
                maxWordsPerLine={20}
            />
        </>
    );
});

export default MainLayout;
