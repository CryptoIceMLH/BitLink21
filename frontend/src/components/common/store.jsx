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

/* global process */

import { configureStore } from '@reduxjs/toolkit';
import { persistStore, persistReducer } from "redux-persist";
import storage from "redux-persist/lib/storage";
import preferencesReducer from '../settings/preferences-slice.jsx';
import dashboardReducer from '../dashboard/dashboard-slice.jsx';
import sdrsReducer from '../hardware/sdr-slice.jsx';
import versionReducer from "../dashboard/version-slice.jsx";
import updateCheckReducer from "../dashboard/update-slice.jsx";
import performanceReducer from '../performance/performance-slice.jsx';
import systemInfoReducer from '../settings/system-info-slice.jsx';
import sessionsReducer from '../settings/sessions-slice.jsx';
import tasksReducer from '../tasks/tasks-slice.jsx';
import bitlink21Reducer from '../bitlink21/bitlink21-slice.jsx';

// BitLink21 state. The Ground Station slices (waterfall, VFOs, satellites,
// tracking, rigs, rotators, cameras, scheduler, file browser, decoders,
// station location) were removed with their pages.

// Only the theme preference is restored from the browser; the rest comes
// from the server
const preferencesStateReconciler = (inboundState, originalState) => {
    const persistedTheme = inboundState?.preferences?.find((pref) => pref.name === 'theme');
    if (!persistedTheme) return originalState;
    return {
        ...originalState,
        preferences: originalState.preferences.map((pref) =>
            pref.name === 'theme' ? { ...pref, value: persistedTheme.value } : pref),
    };
};

const runtimeOnly = (key, reducer) => persistReducer({ key, storage, whitelist: [] }, reducer);

export const store = configureStore({
    reducer: {
        preferences: persistReducer(
            { key: 'preferences', storage, stateReconciler: preferencesStateReconciler, whitelist: ['preferences'] },
            preferencesReducer),
        dashboard: runtimeOnly('dashboard', dashboardReducer),
        sdrs: runtimeOnly('sdr', sdrsReducer),
        version: runtimeOnly('version', versionReducer),
        updateCheck: runtimeOnly('updateCheck', updateCheckReducer),
        performance: runtimeOnly('performance', performanceReducer),
        systemInfo: runtimeOnly('systemInfo', systemInfoReducer),
        sessions: sessionsReducer,
        backgroundTasks: runtimeOnly('backgroundTasks', tasksReducer),
        bitlink21: runtimeOnly('bitlink21-v4', bitlink21Reducer), // the server is the source of truth
    },
    devTools: process.env.NODE_ENV !== "production",
    middleware: (getDefaultMiddleware) =>
        getDefaultMiddleware({
            immutableCheck: { warnAfter: 256 },
            serializableCheck: {
                warnAfter: 256,
                ignoredActions: ["persist/PERSIST", "persist/REHYDRATE"],
            },
        }),
});

export const persistor = persistStore(store);
