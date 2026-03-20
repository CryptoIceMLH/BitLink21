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


import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './i18n/config.js'
import {BrowserRouter, createBrowserRouter, Route, RouterProvider, Routes} from "react-router";
import {
    SettingsTabLocation,
    SettingsTabRotator,
    SettingsTabPreferences,
    SettingsTabSatellites,
    SettingsTabMaintenance,
    SettingsTabRig,
    SettingsTabTLESources,
    SettingsTabAbout,
    SettingsTabSatelliteGroups,
    SettingsTabCamera,
    SettingsTabSDR
} from "./components/settings/settings.jsx";
import GlobalSatelliteTrackLayout from "./components/overview/main-layout.jsx";
import App from "./App.jsx";
import Layout from "./components/dashboard/dashboard-layout.jsx";
import TargetSatelliteLayout from "./components/target/main-layout.jsx";
import MainWaterfallDisplay from "./components/waterfall/waterfall-island.jsx";
import {SocketProvider, useSocket} from './components/common/socket.jsx';
import { Provider as ReduxProvider} from 'react-redux';
import { PersistGate } from 'redux-persist/integration/react';
import { store, persistor } from './components/common/store.jsx';
import ErrorPage from './components/common/error-page.jsx';
import MainLayout from "./components/waterfall/main-layout.jsx";
import {WakeLockProvider} from "./components/dashboard/wake-lock-provider.jsx";
import { AudioProvider, useAudio } from "./components/dashboard/audio-provider.jsx";
import SatelliteInfoPage from "./components/satellites/satellite-info-page.jsx";
import FilebrowserMain from "./components/filebrowser/filebrowser-main.jsx";
import ScheduledObservationsLayout from "./components/scheduler/main-layout.jsx";
import MessagesPage from "./components/bitlink21/messages-page.jsx";
import IdentityPage from "./components/bitlink21/identity-page.jsx";
import BitcoinPage from "./components/bitlink21/bitcoin-page.jsx";
import LightningPage from "./components/bitlink21/lightning-page.jsx";



const router = createBrowserRouter([
    {
        Component: App, // root layout route
        children: [
            {
                path: "/",
                Component: Layout,
                children: [
                    {
                        path: "",
                        errorElement: <ErrorPage />,
                        Component: GlobalSatelliteTrackLayout,
                    },
                    {
                        path: "track",
                        Component: TargetSatelliteLayout,
                    },
                    {
                        path: "waterfall",
                        Component: MainLayout,
                    },
                    {
                        path: "bitlink21",
                        children: [
                            {
                                path: "messages",
                                Component: MessagesPage,
                            },
                            {
                                path: "identity",
                                Component: IdentityPage,
                            },
                            {
                                path: "bitcoin",
                                Component: BitcoinPage,
                            },
                            {
                                path: "lightning",
                                Component: LightningPage,
                            },
                        ],
                    },
                    {
                        path: "filebrowser",
                        Component: FilebrowserMain,
                    },
                    {
                        path: "scheduler",
                        Component: ScheduledObservationsLayout,
                    },
                    {
                        path: "satellite/:noradId",
                        Component: SatelliteInfoPage,
                    },
                    {
                        path: "satellites",
                        children: [
                            {
                                path: "tlesources",
                                Component: SettingsTabTLESources,
                            },
                            {
                                path: "satellites",
                                Component: SettingsTabSatellites,
                            },
                            {
                                path: "groups",
                                Component: SettingsTabSatelliteGroups,
                            },
                        ],
                    },
                    {
                        path: "settings",
                        children: [
                            {
                                path: "preferences",
                                Component: SettingsTabPreferences,
                            },
                            {
                                path: "location",
                                Component: SettingsTabLocation,
                            },
                            // {
                            //     path: "users",
                            //     Component: SettingsTabUsers,
                            // },
                            {
                                path: "maintenance",
                                Component: SettingsTabMaintenance,
                            },
                            {
                                path: "about",
                                Component: SettingsTabAbout,
                            },
                        ],
                    },
                    {
                        path: "hardware",
                        children: [
                            {
                                path: "rig",
                                Component: SettingsTabRig,
                            },
                            {
                                path: "rotator",
                                Component: SettingsTabRotator,
                            },
                            {
                                path: "cameras",
                                Component: SettingsTabCamera,
                            },
                            {
                                path: "sdrs",
                                Component: SettingsTabSDR,
                            },
                        ],
                    },
                ],
            },
        ],
    },
]);

createRoot(document.getElementById('root')).render(
    <StrictMode>
        <ReduxProvider store={store}>
            <PersistGate loading={null} persistor={persistor}>
                <SocketProvider>
                    <WakeLockProvider>
                        <RouterProvider router={router} />
                    </WakeLockProvider>
                </SocketProvider>
            </PersistGate>
        </ReduxProvider>
    </StrictMode>
);