import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';

// All BitLink21 state lives on the server (station profile, settings,
// messages). This slice mirrors it and receives live Socket.IO updates.

const request = (kind, command) => createAsyncThunk(
    `bitlink21/${command}`,
    async ({ socket, ...data } = {}, { rejectWithValue }) => {
        try {
            return await new Promise((resolve, reject) => {
                if (!socket) {
                    reject(new Error('Not connected to the server'));
                    return;
                }
                socket.emit(kind, `bitlink21:${command}`, data, (res) => {
                    if (res?.success) resolve(res.data);
                    else reject(new Error(res?.error || `${command} failed`));
                });
            });
        } catch (error) {
            return rejectWithValue(error.message);
        }
    }
);

export const fetchState = request('data_request', 'get_state');
export const updateSettings = request('data_submission', 'update_settings');
export const startStation = request('data_submission', 'start_station');
export const stopStation = request('data_submission', 'stop_station');
export const calibrateRx = request('data_submission', 'calibrate_rx');
export const sendMessage = request('data_submission', 'send_message');
export const sendFile = request('data_submission', 'send_file');
export const fetchMessages = request('data_request', 'get_messages');
export const deleteMessage = request('data_submission', 'delete_message');
export const fetchFiles = request('data_request', 'get_files');
export const deleteFile = request('data_submission', 'delete_file');
export const testBitcoinConnection = request('data_submission', 'bitcoin_test_connection');

const applyState = (state, data) => {
    if (!data) return;
    state.settings = data.settings;
    state.plan = data.plan;
    state.modes = data.modes || state.modes;
    state.presets = data.presets || state.presets;
    state.stationRunning = data.station_running;
    state.plutoAvailable = data.pluto_available;
    if (!data.station_running) state.status = null;
    else if (data.last_status) state.status = data.last_status;
    state.loaded = true;
};

const bitlink21Slice = createSlice({
    name: 'bitlink21',
    initialState: {
        loaded: false,
        settings: null,
        plan: null,
        modes: [],
        presets: {},
        stationRunning: false,
        plutoAvailable: false,
        stationError: null,
        busy: false,
        status: null,          // live bitlink21_status from the worker
        messages: [],
        files: [],
        lastError: null,
    },
    reducers: {
        statusReceived(state, action) {
            state.status = action.payload;
            state.stationRunning = true;
        },
        stationStateChanged(state, action) {
            const { running, error, plan } = action.payload || {};
            state.stationRunning = !!running;
            state.stationError = error || null;
            if (plan) state.plan = plan;
            if (!running) state.status = null;
        },
        messageUpserted(state, action) {
            const msg = action.payload;
            const idx = state.messages.findIndex((m) => m.id === msg.id);
            if (idx >= 0) state.messages[idx] = msg;
            else state.messages.unshift(msg);
        },
        fileReceived(state, action) {
            if (!state.files.some((f) => f.id === action.payload.id)) state.files.unshift(action.payload);
        },
        settingsChanged(state, action) {
            state.settings = action.payload;
        },
        clearError(state) {
            state.lastError = null;
            state.stationError = null;
        },
    },
    extraReducers: (builder) => {
        const pending = (state) => { state.busy = true; state.lastError = null; };
        const failed = (state, action) => { state.busy = false; state.lastError = action.payload || action.error?.message; };
        const gotState = (state, action) => {
            state.busy = false;
            applyState(state, action.payload);
            if (action.type === startStation.fulfilled.type) state.stationError = null;
        };

        for (const thunk of [fetchState, updateSettings, startStation, stopStation, calibrateRx]) {
            builder.addCase(thunk.pending, pending).addCase(thunk.fulfilled, gotState).addCase(thunk.rejected, failed);
        }
        builder
            .addCase(sendMessage.pending, pending)
            .addCase(sendMessage.fulfilled, (state) => { state.busy = false; })
            .addCase(sendMessage.rejected, failed)
            .addCase(sendFile.pending, pending)
            .addCase(sendFile.fulfilled, (state) => { state.busy = false; })
            .addCase(sendFile.rejected, failed)
            .addCase(fetchMessages.fulfilled, (state, action) => { state.messages = action.payload || []; })
            .addCase(deleteMessage.fulfilled, (state, action) => {
                state.messages = state.messages.filter((m) => m.id !== action.meta.arg.id);
            })
            .addCase(fetchFiles.fulfilled, (state, action) => { state.files = action.payload || []; })
            .addCase(deleteFile.fulfilled, (state, action) => {
                state.files = state.files.filter((f) => f.id !== action.meta.arg.id);
            });
    },
});

export const {
    statusReceived,
    stationStateChanged,
    messageUpserted,
    fileReceived,
    settingsChanged,
    clearError,
} = bitlink21Slice.actions;

export default bitlink21Slice.reducer;
