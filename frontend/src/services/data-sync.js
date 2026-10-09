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

import { store } from '../components/common/store.jsx';
import { fetchVersionInfo } from "../components/dashboard/version-slice.jsx";
import { fetchPreferences } from '../components/settings/preferences-slice.jsx';
import { fetchLocationForUserId } from '../components/settings/location-slice.jsx';
import { fetchSDRs } from '../components/hardware/sdr-slice.jsx';
import {
    setInitialDataLoading,
    setInitialDataProgress,
    setShowLocationSetupDialog,
} from '../components/dashboard/dashboard-slice.jsx';

/**
 * Initialize all application data from backend when connection is established
 * @param {Object} socket - Socket.IO connection instance
 */
export async function initializeAppData(socket) {
    const tasks = [
        {
            name: 'preferences',
            run: () => store.dispatch(fetchPreferences({ socket })),
        },
        {
            name: 'version',
            run: () => store.dispatch(fetchVersionInfo()),
        },
        {
            name: 'location',
            run: async () => {
                try {
                    const location = await store.dispatch(fetchLocationForUserId({ socket })).unwrap();
                    console.log('Location fetched from backend:', location);
                    if (!location) {
                        console.log('Location is not set - showing dialog');
                        store.dispatch(setShowLocationSetupDialog(true));
                    } else {
                        console.log('Location is set:', location);
                    }
                } catch (error) {
                    console.error('Failed to fetch location:', error);
                }
            },
        },
        { name: 'sdrs', run: () => store.dispatch(fetchSDRs({ socket })) },
        // Rigs, rotators, cameras, satellites, maps and the scheduler were removed
        // with their pages; the classic radio only needs the SDR list.
    ];

    let completed = 0;
    const total = tasks.length;
    store.dispatch(setInitialDataLoading(true));
    store.dispatch(setInitialDataProgress({ completed, total }));

    const incrementProgress = () => {
        completed += 1;
        store.dispatch(setInitialDataProgress({ completed, total }));
    };

    const runTask = async (task) => {
        try {
            await task.run();
        } catch (error) {
            console.error(`Failed to fetch initial app data: ${task.name}`, error);
        } finally {
            incrementProgress();
        }
    };

    // Load preferences first so UI/notifications are aligned before other requests.
    const [preferencesTask, ...remainingTasks] = tasks;
    await runTask(preferencesTask);

    await Promise.allSettled(remainingTasks.map((task) => runTask(task)));

    store.dispatch(setInitialDataLoading(false));
}
