import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';

// --- Async Thunks (Socket.IO requests) ---

export const fetchIdentity = createAsyncThunk(
    'bitlink21/fetchIdentity',
    async ({ socket }, { rejectWithValue }) => {
        try {
            return await new Promise((resolve, reject) => {
                socket.emit('data_request', 'bitlink21:get_identity', null, (res) => {
                    if (res.success) resolve(res.data);
                    else reject(new Error(res.error || 'Failed to fetch identity'));
                });
            });
        } catch (error) {
            return rejectWithValue(error.message);
        }
    }
);

export const setIdentity = createAsyncThunk(
    'bitlink21/setIdentity',
    async ({ socket, npub, nsec }, { rejectWithValue }) => {
        try {
            return await new Promise((resolve, reject) => {
                socket.emit('data_submission', 'bitlink21:set_identity', { npub, nsec }, (res) => {
                    if (res.success) resolve(res.data);
                    else reject(new Error(res.error || 'Failed to set identity'));
                });
            });
        } catch (error) {
            return rejectWithValue(error.message);
        }
    }
);

export const fetchContacts = createAsyncThunk(
    'bitlink21/fetchContacts',
    async ({ socket }, { rejectWithValue }) => {
        try {
            return await new Promise((resolve, reject) => {
                socket.emit('data_request', 'bitlink21:get_contacts', null, (res) => {
                    if (res.success) resolve(res.data);
                    else reject(new Error(res.error || 'Failed to fetch contacts'));
                });
            });
        } catch (error) {
            return rejectWithValue(error.message);
        }
    }
);

export const addContact = createAsyncThunk(
    'bitlink21/addContact',
    async ({ socket, npub, nickname }, { rejectWithValue }) => {
        try {
            return await new Promise((resolve, reject) => {
                socket.emit('data_submission', 'bitlink21:add_contact', { npub, nickname }, (res) => {
                    if (res.success) resolve(res.data);
                    else reject(new Error(res.error || 'Failed to add contact'));
                });
            });
        } catch (error) {
            return rejectWithValue(error.message);
        }
    }
);

export const deleteContact = createAsyncThunk(
    'bitlink21/deleteContact',
    async ({ socket, npub }, { rejectWithValue }) => {
        try {
            return await new Promise((resolve, reject) => {
                socket.emit('data_submission', 'bitlink21:delete_contact', { npub }, (res) => {
                    if (res.success) resolve(npub);
                    else reject(new Error(res.error || 'Failed to delete contact'));
                });
            });
        } catch (error) {
            return rejectWithValue(error.message);
        }
    }
);

export const fetchMessages = createAsyncThunk(
    'bitlink21/fetchMessages',
    async ({ socket, limit = 50, offset = 0 }, { rejectWithValue }) => {
        try {
            return await new Promise((resolve, reject) => {
                socket.emit('data_request', 'bitlink21:get_messages', { limit, offset }, (res) => {
                    if (res.success) resolve(res.data);
                    else reject(new Error(res.error || 'Failed to fetch messages'));
                });
            });
        } catch (error) {
            return rejectWithValue(error.message);
        }
    }
);

export const fetchOutbox = createAsyncThunk(
    'bitlink21/fetchOutbox',
    async ({ socket, limit = 50, offset = 0 }, { rejectWithValue }) => {
        try {
            return await new Promise((resolve, reject) => {
                socket.emit('data_request', 'bitlink21:get_outbox', { limit, offset }, (res) => {
                    if (res.success) resolve(res.data);
                    else reject(new Error(res.error || 'Failed to fetch outbox'));
                });
            });
        } catch (error) {
            return rejectWithValue(error.message);
        }
    }
);

export const sendMessage = createAsyncThunk(
    'bitlink21/sendMessage',
    async ({ socket, destination_npub, payload_type, body, encrypted, broadcast }, { rejectWithValue }) => {
        try {
            return await new Promise((resolve, reject) => {
                socket.emit('data_submission', 'bitlink21:send_message', {
                    destination_npub, payload_type, body, encrypted, broadcast
                }, (res) => {
                    if (res.success) resolve(res.data);
                    else reject(new Error(res.error || 'Failed to send message'));
                });
            });
        } catch (error) {
            return rejectWithValue(error.message);
        }
    }
);

export const fetchStats = createAsyncThunk(
    'bitlink21/fetchStats',
    async ({ socket }, { rejectWithValue }) => {
        try {
            return await new Promise((resolve, reject) => {
                socket.emit('data_request', 'bitlink21:get_stats', null, (res) => {
                    if (res.success) resolve(res.data);
                    else reject(new Error(res.error || 'Failed to fetch stats'));
                });
            });
        } catch (error) {
            return rejectWithValue(error.message);
        }
    }
);

export const fetchConfig = createAsyncThunk(
    'bitlink21/fetchConfig',
    async ({ socket, key }, { rejectWithValue }) => {
        try {
            return await new Promise((resolve, reject) => {
                socket.emit('data_request', 'bitlink21:get_config', { key }, (res) => {
                    if (res.success) resolve(res.data);
                    else reject(new Error(res.error || 'Failed to fetch config'));
                });
            });
        } catch (error) {
            return rejectWithValue(error.message);
        }
    }
);

export const setConfig = createAsyncThunk(
    'bitlink21/setConfig',
    async ({ socket, key, value }, { rejectWithValue }) => {
        try {
            return await new Promise((resolve, reject) => {
                socket.emit('data_submission', 'bitlink21:set_config', { key, value }, (res) => {
                    if (res.success) resolve(res.data);
                    else reject(new Error(res.error || 'Failed to set config'));
                });
            });
        } catch (error) {
            return rejectWithValue(error.message);
        }
    }
);

// --- Slice ---

const bitlink21Slice = createSlice({
    name: 'bitlink21',
    initialState: {
        // Identity
        identity: null,
        identityLoading: false,
        identityError: null,

        // Contacts
        contacts: [],
        contactsLoading: false,
        contactsError: null,

        // Messages (inbox)
        messages: [],
        messagesLoading: false,
        messagesError: null,

        // Outbox
        outbox: { entries: [], pending_count: 0 },
        outboxLoading: false,
        outboxError: null,

        // Send message
        sendLoading: false,
        sendError: null,

        // Stats
        stats: null,
        statsLoading: false,

        // Config (key-value cache)
        config: {},
        configLoading: false,

        // TX controls
        pttActive: false,
        txFreq: null,
        txGain: -20,

        // Beacon AFC
        beaconLockState: 'UNLOCKED',
        beaconOffset: 0,
        beaconPhaseError: 0,
        beaconSpectrum: null,  // Array of dB values from beacon FFT
        beaconXoCorrection: 0,

        // Constellation
        constellationPoints: [],
    },
    reducers: {
        setPttActive(state, action) {
            state.pttActive = action.payload;
        },
        setTxFreq(state, action) {
            state.txFreq = action.payload;
        },
        setTxGain(state, action) {
            state.txGain = action.payload;
        },
        updateBeaconStatus(state, action) {
            const { lock_state, offset_hz, phase_error_deg, xo_correction, spectrum } = action.payload;
            if (lock_state !== undefined) state.beaconLockState = lock_state;
            if (offset_hz !== undefined) state.beaconOffset = offset_hz;
            if (phase_error_deg !== undefined) state.beaconPhaseError = phase_error_deg;
            if (xo_correction !== undefined) state.beaconXoCorrection = xo_correction;
            if (spectrum !== undefined) state.beaconSpectrum = spectrum;
        },
        updateConstellationPoints(state, action) {
            state.constellationPoints = action.payload;
        },
        addIncomingMessage(state, action) {
            state.messages.unshift(action.payload);
        },
    },
    extraReducers: (builder) => {
        // Identity
        builder
            .addCase(fetchIdentity.pending, (state) => { state.identityLoading = true; state.identityError = null; })
            .addCase(fetchIdentity.fulfilled, (state, action) => { state.identityLoading = false; state.identity = action.payload; })
            .addCase(fetchIdentity.rejected, (state, action) => { state.identityLoading = false; state.identityError = action.payload; })

            .addCase(setIdentity.fulfilled, (state, action) => { state.identity = action.payload; })

        // Contacts
            .addCase(fetchContacts.pending, (state) => { state.contactsLoading = true; state.contactsError = null; })
            .addCase(fetchContacts.fulfilled, (state, action) => { state.contactsLoading = false; state.contacts = action.payload || []; })
            .addCase(fetchContacts.rejected, (state, action) => { state.contactsLoading = false; state.contactsError = action.payload; })

            .addCase(addContact.fulfilled, (state, action) => { state.contacts.push(action.payload); })
            .addCase(deleteContact.fulfilled, (state, action) => {
                state.contacts = state.contacts.filter(c => c.npub !== action.payload);
            })

        // Messages
            .addCase(fetchMessages.pending, (state) => { state.messagesLoading = true; state.messagesError = null; })
            .addCase(fetchMessages.fulfilled, (state, action) => { state.messagesLoading = false; state.messages = action.payload || []; })
            .addCase(fetchMessages.rejected, (state, action) => { state.messagesLoading = false; state.messagesError = action.payload; })

        // Outbox
            .addCase(fetchOutbox.pending, (state) => { state.outboxLoading = true; state.outboxError = null; })
            .addCase(fetchOutbox.fulfilled, (state, action) => { state.outboxLoading = false; state.outbox = action.payload || { entries: [], pending_count: 0 }; })
            .addCase(fetchOutbox.rejected, (state, action) => { state.outboxLoading = false; state.outboxError = action.payload; })

        // Send message
            .addCase(sendMessage.pending, (state) => { state.sendLoading = true; state.sendError = null; })
            .addCase(sendMessage.fulfilled, (state) => { state.sendLoading = false; })
            .addCase(sendMessage.rejected, (state, action) => { state.sendLoading = false; state.sendError = action.payload; })

        // Stats
            .addCase(fetchStats.pending, (state) => { state.statsLoading = true; })
            .addCase(fetchStats.fulfilled, (state, action) => { state.statsLoading = false; state.stats = action.payload; })
            .addCase(fetchStats.rejected, (state) => { state.statsLoading = false; })

        // Config
            .addCase(fetchConfig.fulfilled, (state, action) => {
                if (action.payload) state.config[action.payload.key] = action.payload.value;
            })
            .addCase(setConfig.fulfilled, (state, action) => {
                if (action.payload) state.config[action.payload.key] = action.payload.value;
            });
    },
});

export const {
    setPttActive,
    setTxFreq,
    setTxGain,
    updateBeaconStatus,
    updateConstellationPoints,
    addIncomingMessage,
} = bitlink21Slice.actions;

export default bitlink21Slice.reducer;
