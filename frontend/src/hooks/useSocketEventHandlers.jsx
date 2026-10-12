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

import { useEffect } from 'react';
import { useDispatch } from 'react-redux';
import { useTranslation } from 'react-i18next';
import SyncIcon from '@mui/icons-material/Sync';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import CancelIcon from '@mui/icons-material/Cancel';
import { toast } from '../utils/toast-with-timestamp.jsx';
import { initializeAppData } from '../services/data-sync.js';
import {
    setConnected,
    setConnecting,
    setInitialDataLoading,
    setInitialDataProgress,
    setReConnectAttempt,
} from '../components/dashboard/dashboard-slice.jsx';
import { updateMetrics } from '../components/performance/performance-slice.jsx';
import { setSystemInfo } from '../components/settings/system-info-slice.jsx';
import { setRuntimeSnapshot } from '../components/settings/sessions-slice.jsx';
import {
    statusReceived as bitlink21StatusReceived,
    stationStateChanged as bitlink21StationStateChanged,
    messageUpserted as bitlink21MessageUpserted,
    fileReceived as bitlink21FileReceived,
    settingsChanged as bitlink21SettingsChanged,
    txProgressReceived as bitlink21TxProgressReceived,
} from '../components/bitlink21/bitlink21-slice.jsx';
import {
    taskStarted,
    taskProgress,
    taskCompleted,
    taskStopped,
    taskError,
    setTaskList,
} from '../components/tasks/tasks-slice.jsx';

// Toast message component with title and body
const ToastMessage = ({ title, body }) => (
    <div>
        <div style={{ fontWeight: 600, marginBottom: '4px' }}>{title}</div>
        {body && <div style={{ fontSize: '13px', opacity: 0.9 }}>{body}</div>}
    </div>
);

/**
 * App-wide socket listeners: connection state, system info, background
 * tasks and the BitLink21 station. (The Ground Station listeners for the old
 * waterfall, recording, tracking, decoders, scheduler and file browser were
 * removed with those pages.) The Radio and Dish alignment pages subscribe to
 * their own high-rate streams locally.
 */
export const useSocketEventHandlers = (socket) => {
    const { t } = useTranslation('common');
    const dispatch = useDispatch();

    useEffect(() => {
        if (!socket) return undefined;

        const handlers = {
            connect: async () => {
                dispatch(setConnecting(false));
                dispatch(setConnected(true));
                dispatch(setInitialDataLoading(true));
                dispatch(setInitialDataProgress({ completed: 0, total: 0 }));
                socket.emit('background_task:list', { filter: 'all' });
                await initializeAppData(socket);
            },
            reconnect_attempt: (attempt) => {
                dispatch(setReConnectAttempt(attempt));
                toast.info(
                    <ToastMessage
                        title={t('notifications.connection.reconnecting_to_backend')}
                        body={t('notifications.connection.attempt', { attempt })}
                    />,
                    { icon: () => <SyncIcon /> },
                );
            },
            error: (error) => {
                toast.error(
                    <ToastMessage title={t('notifications.connection.connection_error')} body={error} />,
                    { icon: () => <ErrorOutlineIcon /> },
                );
            },
            disconnect: () => {
                dispatch(setConnecting(true));
                dispatch(setConnected(false));
                dispatch(setInitialDataLoading(false));
            },
            'system-info': (payload) => dispatch(setSystemInfo(payload)),
            'session-runtime-snapshot': (snapshot) => dispatch(setRuntimeSnapshot(snapshot)),
            'performance-metrics': (data) => dispatch(updateMetrics(data)),

            'background_task:started': (data) => dispatch(taskStarted(data)),
            'background_task:progress': (data) => dispatch(taskProgress(data)),
            'background_task:completed': (data) => dispatch(taskCompleted(data)),
            'background_task:stopped': (data) => {
                dispatch(taskStopped(data));
                toast.warning(
                    <ToastMessage title={`Task stopped: ${data.name}`} body={`Duration: ${Math.floor(data.duration / 1000)}s`} />,
                    { icon: () => <CancelIcon />, autoClose: 5000 },
                );
            },
            'background_task:error': (data) => {
                dispatch(taskError(data));
                toast.error(
                    <ToastMessage title={`Task error: ${data.name}`} body={data.error} />,
                    { icon: () => <ErrorOutlineIcon />, autoClose: 8000 },
                );
            },
            'background_task:list': (data) => dispatch(setTaskList(data)),

            'bitlink21:status': (data) => dispatch(bitlink21StatusReceived(data)),
            'bitlink21:station_state': (data) => {
                dispatch(bitlink21StationStateChanged(data));
                if (data?.error) toast.error(data.error, { autoClose: 8000 });
            },
            'bitlink21:message': (data) => dispatch(bitlink21MessageUpserted(data)),
            'bitlink21:tx_progress': (data) => dispatch(bitlink21TxProgressReceived(data)),
            'bitlink21:file': (data) => dispatch(bitlink21FileReceived(data)),
            'bitlink21:settings': (data) => dispatch(bitlink21SettingsChanged(data)),
        };

        for (const [event, handler] of Object.entries(handlers)) socket.on(event, handler);
        return () => {
            for (const [event, handler] of Object.entries(handlers)) socket.off(event, handler);
        };
    }, [socket, dispatch, t]);
};
