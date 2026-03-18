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


import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';

const defaultTLESource = {
    id: null,
    name: '',
    url: '',
    format: '',
    // Add any TLE source-specific fields here
};

export const fetchTLESources = createAsyncThunk(
    'tleSources/fetchAll',
    async ({ socket }, { rejectWithValue }) => {
        try {
            // Wrap socket in a Promise for async behavior
            return await new Promise((resolve, reject) => {
                socket.emit('data_request', 'get-tle-sources', null, (res) => {
                    if (res.success) {
                        resolve(res.data);
                    } else {
                        reject(new Error('Failed to fetch TLE sources'));
                    }
                });
            });
        } catch (error) {
            return rejectWithValue(error.message);
        }
    }
);

export const deleteTLESources = createAsyncThunk(
    'tleSources/deleteTleSources',
    async ({ socket, selectedIds }, { rejectWithValue }) => {
        try {
            return await new Promise((resolve, reject) => {
                socket.emit('data_submission', 'delete-tle-sources', selectedIds, (response) => {
                    if (response.success) {
                        resolve({data: response.data, message: response.message, summary: response.summary});
                    } else {
                        reject(new Error('Failed to delete TLE sources'));
                    }
                });
            });
        } catch (error) {
            return rejectWithValue(error.message);
        }
    }
);

export const submitOrEditTLESource = createAsyncThunk(
    'tleSources/submitOrEdit',
    async ({ socket, formValues }, { rejectWithValue, dispatch }) => {
        const action = formValues.id ? 'edit-tle-source' : 'submit-tle-sources';
        try {
            return await new Promise((resolve, reject) => {
                socket.emit('data_submission', action, formValues, (response) => {
                    if (response.success) {
                        resolve(response.data);
                    } else {
                        reject(new Error(`Failed to ${action === 'edit-tle-source' ? 'edit' : 'add'} TLE source`));
                    }
                });
            });
        } catch (error) {
            return rejectWithValue(error.message);
        }
    }
);

// Create the slice, mirroring rig-slice structure:
const sourcesSlice = createSlice({
    name: 'tleSources',
    initialState: {
        tleSources: [],
        status: 'idle',    // 'idle' | 'loading' | 'succeeded' | 'failed'
        error: null,
        openDeleteConfirm: false,
        openAddDialog: false,
        selected: [],
        loading: false,
        pageSize: 10,
        formValues: defaultTLESource,
    },
    reducers: {
        setTleSources: (state, action) => {
            state.tleSources = action.payload;
        },
        setLoading: (state, action) => {
            state.loading = action.payload;
        },
        setPageSize: (state, action) => {
            state.pageSize = action.payload;
        },
        setOpenDeleteConfirm: (state, action) => {
            state.openDeleteConfirm = action.payload;
        },
        setOpenAddDialog: (state, action) => {
            state.openAddDialog = action.payload;
        },
        setSelected: (state, action) => {
            state.selected = action.payload;
        },
        setFormValues: (state, action) => {
            state.formValues = {
                ...state.formValues,
                ...action.payload,
            };
        },
        resetFormValues: (state) => {
            state.formValues = defaultTLESource;
        },
        setError: (state, action) => {
            state.error = action.payload;
        },
        setStatus: (state, action) => {
            state.status = action.payload;
        },
    },
    extraReducers: (builder) => {
        builder
            .addCase(fetchTLESources.pending, (state) => {
                state.status = 'loading';
                state.loading = true;
                state.error = null;
            })
            .addCase(fetchTLESources.fulfilled, (state, action) => {
                state.status = 'succeeded';
                state.loading = false;
                state.tleSources = action.payload;
            })
            .addCase(fetchTLESources.rejected, (state, action) => {
                state.status = 'failed';
                state.loading = false;
                state.error = action.error?.message;
            })
            .addCase(deleteTLESources.pending, (state) => {
                state.loading = true;
            })
            .addCase(deleteTLESources.fulfilled, (state, action) => {
                state.tleSources = action.payload.data;
                state.openDeleteConfirm = false;
                state.loading = false;
            })
            .addCase(deleteTLESources.rejected, (state, action) => {
                state.loading = false;
                state.error = action.error?.message;
            })
            .addCase(submitOrEditTLESource.pending, (state) => {
                state.loading = true;
            })
            .addCase(submitOrEditTLESource.fulfilled, (state, action) => {
                state.tleSources = action.payload;
                state.loading = false;
            })
            .addCase(submitOrEditTLESource.rejected, (state, action) => {
                state.loading = false;
                state.error = action.error?.message;
            });
    },
});

// Export the slice’s reducer and actions
export const {
    setTleSources,
    setLoading,
    setPageSize,
    setOpenDeleteConfirm,
    setOpenAddDialog,
    setSelected,
    setFormValues,
    resetFormValues,
    setError,
    setStatus,
} = sourcesSlice.actions;

export default sourcesSlice.reducer;