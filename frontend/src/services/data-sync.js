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
import { fetchSDRs } from '../components/hardware/sdr-slice.jsx';
import {
    setInitialDataLoading,
    setInitialDataProgress,
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
        { name: 'sdrs', run: () => store.dispatch(fetchSDRs({ socket })) },
        // BitLink21 needs no station location (QO-100 is geostationary); rigs,
        // rotators, satellites, maps and the scheduler were removed with their pages.
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
