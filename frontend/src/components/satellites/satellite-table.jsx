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


import * as React from 'react';
import {
    Alert,
    AlertTitle,
    Box,
    Button,
    Chip,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    FormControl,
    FormControlLabel,
    OutlinedInput,
    InputAdornment,
    IconButton,
    InputLabel,
    ListSubheader,
    MenuItem,
    Select,
    Stack,
    TextField,
    Checkbox,
    Tooltip,
    Typography,
} from "@mui/material";
import {useEffect, useState, useCallback} from "react";
import {useDispatch, useSelector} from "react-redux";
import { toast } from '../../utils/toast-with-timestamp.jsx';
import {
    DataGrid,
    gridPageCountSelector,
    GridPagination,
    useGridApiContext,
    useGridSelector,
    gridClasses
} from '@mui/x-data-grid';
import MuiPagination from '@mui/material/Pagination';
import {
    betterDateTimes,
    betterStatusValue,
    renderCountryFlagsCSV,
    getFrequencyBand, getBandColor
} from '../common/common.jsx';
import {
    fetchSatelliteGroups,
    fetchSatellites,
    searchSatellites,
    submitOrEditSatellite,
    deleteSatellite,
    setSatGroupId,
    setSearchKeyword,
    setSelected,
    setFormValues,
    resetFormValues,
    setOpenDeleteConfirm,
    setOpenAddDialog,
    setClickedSatellite,
} from "./satellite-slice.jsx";
import {useSocket} from "../common/socket.jsx";
import { useTranslation } from 'react-i18next';
import SearchIcon from '@mui/icons-material/Search';
import ClearIcon from '@mui/icons-material/Clear';
import { useNavigate } from "react-router-dom";
import TransmittersDialog from "./transmitters-dialog.jsx";
import EditIcon from '@mui/icons-material/Edit';
import VisibilityIcon from '@mui/icons-material/Visibility';

function Pagination({page, onPageChange, className}) {
    const apiRef = useGridApiContext();
    const pageCount = useGridSelector(apiRef, gridPageCountSelector);

    return (
        <MuiPagination
            color="primary"
            className={className}
            count={pageCount}
            page={page + 1}
            onChange={(event, newPage) => {
                onPageChange(event, newPage - 1);
            }}
        />
    );
}

function CustomPagination(props) {
    return <GridPagination ActionsComponent={Pagination} {...props} />;
}

const SatelliteTable = React.memo(function SatelliteTable() {
    const dispatch = useDispatch();
    const {socket} = useSocket();
    const navigate = useNavigate();
    const { t } = useTranslation('satellites');
    const {
        satellites,
        satellitesGroups,
        satGroupId,
        searchKeyword,
        selected,
        loading,
        formValues,
        openDeleteConfirm,
        openAddDialog,
        clickedSatellite,
    } = useSelector((state) => state.satellites);

    const [localSearchValue, setLocalSearchValue] = useState('');
    const [transmittersDialogOpen, setTransmittersDialogOpen] = useState(false);
    const [submitError, setSubmitError] = useState('');
    const [submitErrorFields, setSubmitErrorFields] = useState({});
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Get timezone preference
    const timezone = useSelector((state) => {
        const tzPref = state.preferences?.preferences?.find(p => p.name === 'timezone');
        return tzPref?.value || 'UTC';
    });

    const handleEditRow = (satellite) => {
        if (!satellite) {
            return;
        }
        setSubmitError('');
        setSubmitErrorFields({});
        dispatch(setFormValues({...satellite, id: satellite.norad_id}));
        dispatch(setOpenAddDialog(true));
    };

    const handleViewSatellite = (noradId) => {
        if (!noradId) {
            return;
        }
        navigate(`/satellite/${noradId}`);
    };

    const handleOpenTransmitters = (satellite) => {
        if (!satellite) {
            return;
        }
        dispatch(setClickedSatellite(satellite));
        setTransmittersDialogOpen(true);
    };

    const handleCloseTransmitters = () => {
        setTransmittersDialogOpen(false);
    };

    const columns = [
        {
            field: 'name',
            headerName: t('satellite_database.name'),
            width: 200,
        },
        {
            field: 'norad_id',
            headerName: t('satellite_database.norad_id'),
            width: 100,
        },
        {
            field: 'status',
            headerName: t('satellite_database.status'),
            width: 100,
            headerAlign: 'center',
            align: 'center',
            renderCell: (params) => {
                return betterStatusValue(params.value);
            },
        },
        {
            field: 'countries',
            headerName: t('satellite_database.countries'),
            width: 100,
            headerAlign: 'center',
            align: 'center',
            renderCell: (params) => {
                return renderCountryFlagsCSV(params.value);
            },
        },
        {
            field: 'operator',
            headerName: t('satellite_database.operator'),
            width: 100,
            headerAlign: 'center',
            align: 'center',
            renderCell: (params) => {
                if (params.value !== "None") {
                    return params.value;
                } else {
                    return "-";
                }
            },
        },

        {
            field: 'transmitters',
            minWidth: 220,
            align: 'center',
            headerAlign: 'center',
            headerName: t('satellite_database.bands'),
            sortComparator: (v1, v2) => {
                // Get total transmitter count for comparison
                const count1 = v1 ? v1.length : 0;
                const count2 = v2 ? v2.length : 0;
                return count1 - count2;
            },
            renderCell: (params) => {
                const transmitters = params.value;
                if (!transmitters) {
                    return t('satellite_database.no_data');
                }

                // Count transmitters per band
                const bandCounts = transmitters.reduce((acc, t) => {
                    const band = getFrequencyBand(t['downlink_low']);
                    acc[band] = (acc[band] || 0) + 1;
                    return acc;
                }, {});

                const bands = Object.keys(bandCounts);

                return (
                    <div style={{
                        display: 'flex',
                        gap: 4,
                        flexWrap: 'wrap',
                        justifyContent: 'center',
                        alignItems: 'center'
                    }}>
                        {bands.map((band, index) => (
                            <div key={index} style={{display: 'flex', alignItems: 'center', gap: 2}}>
                                <Chip
                                    label={`${band}`}
                                    size="small"
                                    sx={{
                                        height: '18px',
                                        fontSize: '0.65rem',
                                        fontWeight: 'bold',
                                        backgroundColor: getBandColor(band),
                                        color: '#ffffff',
                                        '&:hover': {
                                            filter: 'brightness(90%)',
                                        }
                                    }}
                                />
                                <span>x {bandCounts[band]}</span>
                            </div>
                        ))}
                    </div>
                );
            }
        },

        {
            field: 'decayed',
            headerName: t('satellite_database.decayed'),
            width: 150,
            renderCell: (params) => {
                return betterDateTimes(params.value, timezone);
            },
        },
        {
            field: 'launched',
            headerName: t('satellite_database.launched'),
            width: 150,
            renderCell: (params) => {
                return betterDateTimes(params.value, timezone);
            },
        },
        {
            field: 'deployed',
            headerName: t('satellite_database.deployed'),
            width: 150,
            renderCell: (params) => {
                return betterDateTimes(params.value, timezone);
            },
        },
        {
            field: 'updated',
            headerName: t('satellite_database.updated'),
            width: 150,
            renderCell: (params) => {
                return betterDateTimes(params.value, timezone);
            },
        },
        {
            field: 'actions',
            headerName: t('satellite_database.actions'),
            width: 120,
            sortable: false,
            filterable: false,
            headerAlign: 'center',
            align: 'center',
            renderCell: (params) => {
                const satellite = params.row;
                return (
                    <Stack
                        direction="row"
                        spacing={0.5}
                        sx={{
                            width: '100%',
                            height: '100%',
                            alignItems: 'center',
                            justifyContent: 'center',
                        }}
                    >
                        <Tooltip title={t('satellite_database.edit')}>
                            <IconButton
                                size="small"
                                onClick={(event) => {
                                    event.stopPropagation();
                                    handleEditRow(satellite);
                                }}
                            >
                                <EditIcon fontSize="small" />
                            </IconButton>
                        </Tooltip>
                        <Tooltip title={t('satellite_database.view')}>
                            <IconButton
                                size="small"
                                onClick={(event) => {
                                    event.stopPropagation();
                                    handleViewSatellite(satellite.norad_id);
                                }}
                            >
                                <VisibilityIcon fontSize="small" />
                            </IconButton>
                        </Tooltip>
                    </Stack>
                );
            },
        },
    ];

    useEffect(() => {
        dispatch(fetchSatelliteGroups({socket}));
    }, [dispatch]);

    // Debounced search effect
    useEffect(() => {
        if (localSearchValue.length >= 3) {
            const timeoutId = setTimeout(() => {
                // Only search if the keyword actually changed
                if (localSearchValue !== searchKeyword) {
                    dispatch(setSearchKeyword(localSearchValue));
                    dispatch(searchSatellites({socket, keyword: localSearchValue}));
                }
            }, 500); // 500ms debounce delay

            return () => clearTimeout(timeoutId);
        } else if (localSearchValue.length === 0 && searchKeyword !== '') {
            // Clear search when input is empty
            dispatch(setSearchKeyword(''));
            dispatch(setSatGroupId(''));
        }
    }, [localSearchValue, dispatch, socket, searchKeyword, t]);

    const handleOnGroupChange = (event) => {
        const groupId = event.target.value;
        dispatch(setSatGroupId(groupId));
        // Clear search when selecting a group
        setLocalSearchValue('');
        dispatch(setSearchKeyword(''));

        if (groupId !== null) {
            dispatch(fetchSatellites({socket, satGroupId: groupId}))
                .unwrap()
                .then((data) => {
                    toast.success(t('satellite_database.loaded_success', { count: data.length }));
                })
                .catch((err) => {
                    toast.error(t('satellite_database.failed_load') + ": " + err.message)
                });
        }
    };

    const handleSearchChange = (event) => {
        setLocalSearchValue(event.target.value);
    };

    const handleClearSearch = () => {
        setLocalSearchValue('');
        dispatch(setSearchKeyword(''));
        dispatch(setSatGroupId(''));
    };


    const handleAddClick = () => {
        dispatch(resetFormValues());
        setSubmitError('');
        setSubmitErrorFields({});
        dispatch(setOpenAddDialog(true));
    };

    const handleEditClick = () => {
        const selectedId = Number(selected[0]);
        if (Number.isNaN(selectedId)) {
            return;
        }
        const satellite = satellites.find((row) => row.norad_id === selectedId);
        if (!satellite) {
            return;
        }
        setSubmitError('');
        setSubmitErrorFields({});
        dispatch(setFormValues({...satellite, id: selectedId}));
        dispatch(setOpenAddDialog(true));
    };

    const handleCloseDialog = () => {
        if (isSubmitting) {
            return;
        }
        setSubmitError('');
        setSubmitErrorFields({});
        dispatch(setOpenAddDialog(false));
    };

    const handleInputChange = (event) => {
        const {name, value} = event.target;
        if (submitError) {
            setSubmitError('');
            setSubmitErrorFields({});
        }
        dispatch(setFormValues({...formValues, [name]: value}));
    };

    const handleCheckboxChange = (event) => {
        const {name, checked} = event.target;
        dispatch(setFormValues({...formValues, [name]: checked}));
    };

    const refreshSatellites = () => {
        if (searchKeyword && searchKeyword.length >= 3) {
            dispatch(searchSatellites({socket, keyword: searchKeyword}));
            return;
        }
        if (satGroupId) {
            dispatch(fetchSatellites({socket, satGroupId}));
        }
    };

    const handleSubmit = () => {
        if (isSubmitDisabled) {
            return;
        }
        if (isSubmitting) {
            return;
        }
        setIsSubmitting(true);
        setSubmitError('');
        setSubmitErrorFields({});
        const payload = {
            ...formValues,
            norad_id: formValues.norad_id === '' ? '' : Number(formValues.norad_id),
        };
        dispatch(submitOrEditSatellite({socket, formValues: payload}))
            .unwrap()
            .then(() => {
                dispatch(setOpenAddDialog(false));
                dispatch(resetFormValues());
                refreshSatellites();
            })
            .catch((error) => {
                const rawMessage = typeof error === 'string' ? error : (error?.message || String(error));
                setSubmitError(rawMessage);
                const requiredMatch = rawMessage.match(/Missing required field:\s*(\w+)/i);
                if (requiredMatch) {
                    setSubmitErrorFields({ [requiredMatch[1]]: true });
                } else if (/norad/i.test(rawMessage)) {
                    setSubmitErrorFields({ norad_id: true });
                }
            })
            .finally(() => {
                setIsSubmitting(false);
            });
    };

    const handleDeleteClick = () => {
        const deleteRequests = selected
            .map((noradId) => Number(noradId))
            .filter((noradId) => !Number.isNaN(noradId))
            .map((noradId) => dispatch(deleteSatellite({socket, noradId})).unwrap());
        Promise.all(deleteRequests)
            .then(() => {
                toast.success(t('satellite_database.deleted_success'), {autoClose: 4000});
                dispatch(setSelected([]));
                dispatch(setOpenDeleteConfirm(false));
                refreshSatellites();
            })
            .catch((error) => {
                toast.error(`${t('satellite_database.failed_delete')}: ${error}`, {autoClose: 5000});
            });
    };

    const validationErrors = {
        name: !String(formValues.name || '').trim(),
        norad_id: !formValues.id
            && (formValues.norad_id === '' || formValues.norad_id === null || formValues.norad_id === undefined),
        tle1: !String(formValues.tle1 || '').trim(),
        tle2: !String(formValues.tle2 || '').trim(),
    };
    const isSubmitDisabled = Object.values(validationErrors).some(Boolean);

    return (
        <Box elevation={3} sx={{width: '100%', marginTop: 0}}>
            <Alert severity="info">
                <AlertTitle>{t('satellite_database.title')}</AlertTitle>
                {t('satellite_database.subtitle')}
            </Alert>
            <Box sx={{ display: 'flex', gap: 2, marginTop: 2, marginBottom: 1 }}>
                <FormControl sx={{minWidth: 200, flex: 1}} variant={"outlined"}>
                    <InputLabel id="sat-group-select-label">{t('satellite_database.select_group')}</InputLabel>
                    <Select
                        disabled={loading}
                        value={satGroupId}
                        id="grouped-select"
                        labelId="sat-group-select-label"
                        input={
                            <OutlinedInput
                                label={t('satellite_database.select_group')}
                                sx={{
                                    backgroundColor: (theme) =>
                                        theme.palette.mode === 'dark' ? '#121212' : '#ffffff',
                                }}
                            />
                        }
                        variant={"outlined"}
                        onChange={handleOnGroupChange}
                    >
                        <ListSubheader>{t('satellite_database.user_groups')}</ListSubheader>
                        {satellitesGroups.filter(group => group.type === "user").length === 0 ? (
                            <MenuItem disabled value="">
                                {t('satellite_database.none_defined')}
                            </MenuItem>
                        ) : (
                            satellitesGroups.map((group, index) => {
                                if (group.type === "user") {
                                    return <MenuItem value={group.id} key={index}>{group.name} ({group.satellite_ids.length})</MenuItem>;
                                }
                            })
                        )}
                        <ListSubheader>{t('satellite_database.builtin_groups')}</ListSubheader>
                        {satellitesGroups.filter(group => group.type === "system").length === 0 ? (
                            <MenuItem disabled value="">
                                {t('satellite_database.none_defined')}
                            </MenuItem>
                        ) : (
                            satellitesGroups.map((group, index) => {
                                if (group.type === "system") {
                                    return <MenuItem value={group.id} key={index}>{group.name} ({group.satellite_ids.length})</MenuItem>;
                                }
                            })
                        )}
                    </Select>
                </FormControl>
                <TextField
                    sx={{ minWidth: 200, flex: 1 }}
                    variant="outlined"
                    label={t('satellite_database.search_satellites')}
                    value={localSearchValue}
                    onChange={handleSearchChange}
                    disabled={loading}
                    placeholder={t('satellite_database.search_placeholder')}
                    helperText={localSearchValue.length > 0 && localSearchValue.length < 3 ? t('satellite_database.search_min_chars') : ''}
                    InputProps={{
                        startAdornment: (
                            <InputAdornment position="start">
                                <SearchIcon />
                            </InputAdornment>
                        ),
                        endAdornment: localSearchValue && (
                            <InputAdornment position="end">
                                <IconButton
                                    aria-label="clear search"
                                    onClick={handleClearSearch}
                                    edge="end"
                                    size="small"
                                >
                                    <ClearIcon />
                                </IconButton>
                            </InputAdornment>
                        ),
                    }}
                />
            </Box>
            <div>
                <DataGrid
                    getRowId={(satellite) => {
                        return satellite['norad_id'];
                    }}
                    loading={loading}
                    rows={satellites}
                    columns={columns}
                    pageSizeOptions={[5, 10, 20, 50, 100]}
                    checkboxSelection={true}
                    initialState={{
                        pagination: {paginationModel: {pageSize: 10}},
                        sorting: {
                            sortModel: [{field: 'transmitters', sort: 'desc'}],
                        },
                    }}
                    slots={{
                        pagination: CustomPagination,
                    }}
                    onRowSelectionModelChange={(selection) => {
                        const normalized = selection.map((value) => Number(value));
                        dispatch(setSelected(normalized));
                    }}
                    localeText={{
                        noRowsLabel: t('satellite_database.no_satellites')
                    }}
                    sx={{
                        border: 0,
                        marginTop: 2,
                        minHeight: '429px',
                        width: '100%',
                        '& .MuiDataGrid-virtualScroller': {
                            overflowX: 'auto',
                        },
                        [`& .${gridClasses.cell}:focus, & .${gridClasses.cell}:focus-within`]: {
                            outline: 'none',
                        },
                        [`& .${gridClasses.columnHeader}:focus, & .${gridClasses.columnHeader}:focus-within`]: {
                            outline: 'none',
                        },
                        [`& .MuiDataGrid-row`]: {
                            cursor: 'pointer',
                        },
                        '& .MuiDataGrid-overlay': {
                            fontSize: '0.875rem',
                            fontStyle: 'italic',
                            color: 'text.secondary',
                        },
                    }}
                />
                <Stack direction="row" spacing={2} sx={{marginTop: 2}}>
                    <Button variant="contained" onClick={handleAddClick}>
                        {t('satellite_database.add')}
                    </Button>
                    <Button variant="contained" disabled={selected.length !== 1} onClick={handleEditClick}>
                        {t('satellite_database.edit')}
                    </Button>
                    <Button
                        variant="contained"
                        disabled={selected.length !== 1}
                        onClick={() => {
                            const selectedId = Number(selected[0]);
                            if (Number.isNaN(selectedId)) {
                                return;
                            }
                            const satellite = satellites.find((row) => row.norad_id === selectedId);
                            if (!satellite) {
                                return;
                            }
                            handleOpenTransmitters(satellite);
                        }}
                    >
                        {t('satellite_database.edit_transmitters')}
                    </Button>
                    <Button
                        variant="contained"
                        color="error"
                        disabled={selected.length < 1}
                        onClick={() => dispatch(setOpenDeleteConfirm(true))}
                    >
                        {t('satellite_database.delete')}
                    </Button>
                </Stack>
            </div>
            <Dialog
                open={openDeleteConfirm}
                onClose={() => dispatch(setOpenDeleteConfirm(false))}
                maxWidth="sm"
                fullWidth
                PaperProps={{
                    sx: {
                        bgcolor: 'background.paper',
                        borderRadius: 2,
                    }
                }}
            >
                <DialogTitle
                    sx={{
                        bgcolor: 'error.main',
                        color: 'error.contrastText',
                        fontSize: '1.125rem',
                        fontWeight: 600,
                        py: 2,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 1.5,
                    }}
                >
                    <Box
                        component="span"
                        sx={{
                            width: 24,
                            height: 24,
                            borderRadius: '50%',
                            bgcolor: 'error.contrastText',
                            color: 'error.main',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontWeight: 'bold',
                            fontSize: '1rem',
                        }}
                    >
                        !
                    </Box>
                    {t('satellite_database.confirm_deletion')}
                </DialogTitle>
                <DialogContent sx={{ px: 3, pt: 3, pb: 3 }}>
                    <Typography variant="body1" sx={{ mt: 2, mb: 2, color: 'text.primary' }}>
                        {t('satellite_database.confirm_delete_intro')}
                    </Typography>
                    <Typography variant="body2" sx={{ mb: 2, fontWeight: 600, color: 'text.secondary' }}>
                        {selected.length === 1
                            ? t('satellite_database.delete_single_label')
                            : t('satellite_database.delete_multiple_label', {count: selected.length})}
                    </Typography>
                    <Box sx={{
                        maxHeight: 300,
                        overflowY: 'auto',
                        bgcolor: (theme) => theme.palette.mode === 'dark' ? 'grey.900' : 'grey.50',
                        borderRadius: 1,
                        border: (theme) => `1px solid ${theme.palette.divider}`,
                    }}>
                        {selected.map((id, index) => {
                            const satellite = satellites.find((row) => row.norad_id === Number(id));
                            if (!satellite) return null;
                            return (
                                <Box
                                    key={id}
                                    sx={{
                                        p: 2,
                                        borderBottom: index < selected.length - 1 ? (theme) => `1px solid ${theme.palette.divider}` : 'none',
                                    }}
                                >
                                    <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1, color: 'text.primary' }}>
                                        {satellite.name}
                                    </Typography>
                                    <Box sx={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 1, columnGap: 2 }}>
                                        <Typography variant="body2" sx={{ fontSize: '0.813rem', color: 'text.secondary', fontWeight: 500 }}>
                                            {t('satellite_database.norad_id')}:
                                        </Typography>
                                        <Typography variant="body2" sx={{ fontSize: '0.813rem', color: 'text.primary' }}>
                                            {satellite.norad_id}
                                        </Typography>
                                        <Typography variant="body2" sx={{ fontSize: '0.813rem', color: 'text.secondary', fontWeight: 500 }}>
                                            {t('satellite_database.status')}:
                                        </Typography>
                                        <Typography variant="body2" sx={{ fontSize: '0.813rem', color: 'text.primary' }}>
                                            {satellite.status || '-'}
                                        </Typography>
                                    </Box>
                                </Box>
                            );
                        })}
                    </Box>
                    <Box sx={{ mt: 2, p: 2, bgcolor: (theme) => theme.palette.mode === 'dark' ? 'grey.900' : 'grey.50', borderRadius: 1 }}>
                        <Typography variant="body2" sx={{ fontSize: '0.813rem', color: 'warning.main', fontWeight: 500, mb: 1 }}>
                            {t('satellite_database.cannot_undo')}
                        </Typography>
                        <Typography component="div" variant="body2" sx={{ fontSize: '0.813rem', color: 'text.secondary' }}>
                            <ul style={{ margin: 0, paddingLeft: '1.5rem' }}>
                                <li>{t('satellite_database.delete_item_1')}</li>
                                <li>{t('satellite_database.delete_item_2')}</li>
                            </ul>
                        </Typography>
                    </Box>
                </DialogContent>
                <DialogActions
                    sx={{
                        bgcolor: (theme) => theme.palette.mode === 'dark' ? 'grey.900' : 'grey.50',
                        borderTop: (theme) => `1px solid ${theme.palette.divider}`,
                        px: 3,
                        py: 2,
                        gap: 1.5,
                    }}
                >
                    <Button
                        onClick={() => dispatch(setOpenDeleteConfirm(false))}
                        variant="outlined"
                        color="inherit"
                        sx={{
                            minWidth: 100,
                            textTransform: 'none',
                            fontWeight: 500,
                        }}
                    >
                        {t('satellite_database.cancel')}
                    </Button>
                    <Button
                        variant="contained"
                        color="error"
                        onClick={handleDeleteClick}
                        sx={{
                            minWidth: 100,
                            textTransform: 'none',
                            fontWeight: 600,
                        }}
                    >
                        {t('satellite_database.delete')}
                    </Button>
                </DialogActions>
            </Dialog>
            <Dialog
                open={openAddDialog}
                onClose={handleCloseDialog}
                fullWidth
                maxWidth="md"
                PaperProps={{
                    sx: {
                        bgcolor: 'background.paper',
                        border: (theme) => `1px solid ${theme.palette.divider}`,
                        borderRadius: 2,
                    }
                }}
            >
                <DialogTitle
                    sx={{
                        bgcolor: (theme) => theme.palette.mode === 'dark' ? 'grey.900' : 'grey.100',
                        borderBottom: (theme) => `1px solid ${theme.palette.divider}`,
                        fontSize: '1.25rem',
                        fontWeight: 'bold',
                        py: 2.5,
                    }}
                >
                    {formValues.id
                        ? t('satellite_database.dialog_title_edit_name', {
                            name: formValues.name || formValues.norad_id || '',
                        })
                        : t('satellite_database.dialog_title_add')}
                </DialogTitle>
                <DialogContent sx={{ bgcolor: 'background.paper', px: 3, py: 3 }}>
                    <Stack spacing={2} sx={{ mt: 3 }}>
                        {submitError ? (
                            <Alert severity="error">
                                <AlertTitle>
                                    {formValues.id ? t('satellite_database.failed_update') : t('satellite_database.failed_add')}
                                </AlertTitle>
                                {submitError}
                            </Alert>
                        ) : null}
                        <TextField
                            label={t('satellite_database.name')}
                            name="name"
                            value={formValues.name || ''}
                            onChange={handleInputChange}
                            fullWidth
                            required
                            size="small"
                            error={Boolean(validationErrors.name || submitErrorFields.name)}
                            disabled={isSubmitting}
                            sx={{
                                '& .MuiInputBase-root': {
                                    bgcolor: validationErrors.name || submitErrorFields.name
                                        ? 'rgba(244, 67, 54, 0.08)'
                                        : 'transparent',
                                },
                            }}
                        />
                        <TextField
                            label={t('satellite_database.norad_id')}
                            name="norad_id"
                            value={formValues.norad_id || ''}
                            onChange={handleInputChange}
                            fullWidth
                            required
                            type="number"
                            disabled={Boolean(formValues.id) || isSubmitting}
                            size="small"
                            error={Boolean(validationErrors.norad_id || submitErrorFields.norad_id)}
                            sx={{
                                '& .MuiInputBase-root': {
                                    bgcolor: validationErrors.norad_id || submitErrorFields.norad_id
                                        ? 'rgba(244, 67, 54, 0.08)'
                                        : 'transparent',
                                },
                            }}
                        />
                        <TextField
                            label={t('satellite_database.sat_id')}
                            name="sat_id"
                            value={formValues.sat_id || ''}
                            onChange={handleInputChange}
                            fullWidth
                            size="small"
                            disabled={isSubmitting}
                        />
                        <TextField
                            label={t('satellite_database.status')}
                            name="status"
                            value={formValues.status || ''}
                            onChange={handleInputChange}
                            fullWidth
                            size="small"
                            disabled={isSubmitting}
                        />
                        <FormControlLabel
                            control={
                                <Checkbox
                                    checked={Boolean(formValues.is_frequency_violator)}
                                    onChange={handleCheckboxChange}
                                    name="is_frequency_violator"
                                    size="small"
                                    disabled={isSubmitting}
                                />
                            }
                            label={t('satellite_database.is_frequency_violator')}
                        />
                        <TextField
                            label={t('satellite_database.tle1')}
                            name="tle1"
                            value={formValues.tle1 || ''}
                            onChange={handleInputChange}
                            fullWidth
                            required
                            multiline
                            minRows={2}
                            size="small"
                            error={Boolean(validationErrors.tle1 || submitErrorFields.tle1)}
                            disabled={isSubmitting}
                            sx={{
                                '& .MuiInputBase-root': {
                                    bgcolor: validationErrors.tle1 || submitErrorFields.tle1
                                        ? 'rgba(244, 67, 54, 0.08)'
                                        : 'transparent',
                                },
                            }}
                        />
                        <TextField
                            label={t('satellite_database.tle2')}
                            name="tle2"
                            value={formValues.tle2 || ''}
                            onChange={handleInputChange}
                            fullWidth
                            required
                            multiline
                            minRows={2}
                            size="small"
                            error={Boolean(validationErrors.tle2 || submitErrorFields.tle2)}
                            disabled={isSubmitting}
                            sx={{
                                '& .MuiInputBase-root': {
                                    bgcolor: validationErrors.tle2 || submitErrorFields.tle2
                                        ? 'rgba(244, 67, 54, 0.08)'
                                        : 'transparent',
                                },
                            }}
                        />
                        <TextField
                            label={t('satellite_database.operator')}
                            name="operator"
                            value={formValues.operator || ''}
                            onChange={handleInputChange}
                            fullWidth
                            size="small"
                            disabled={isSubmitting}
                        />
                        <TextField
                            label={t('satellite_database.countries')}
                            name="countries"
                            value={formValues.countries || ''}
                            onChange={handleInputChange}
                            fullWidth
                            size="small"
                            disabled={isSubmitting}
                        />
                        <TextField
                            label={t('satellite_database.name_other')}
                            name="name_other"
                            value={formValues.name_other || ''}
                            onChange={handleInputChange}
                            fullWidth
                            size="small"
                            disabled={isSubmitting}
                        />
                        <TextField
                            label={t('satellite_database.alternative_name')}
                            name="alternative_name"
                            value={formValues.alternative_name || ''}
                            onChange={handleInputChange}
                            fullWidth
                            size="small"
                            disabled={isSubmitting}
                        />
                        <TextField
                            label={t('satellite_database.website')}
                            name="website"
                            value={formValues.website || ''}
                            onChange={handleInputChange}
                            fullWidth
                            size="small"
                            disabled={isSubmitting}
                        />
                        <TextField
                            label={t('satellite_database.image')}
                            name="image"
                            value={formValues.image || ''}
                            onChange={handleInputChange}
                            fullWidth
                            size="small"
                            disabled={isSubmitting}
                        />
                    </Stack>
                </DialogContent>
                <DialogActions
                    sx={{
                        bgcolor: (theme) => theme.palette.mode === 'dark' ? 'grey.900' : 'grey.100',
                        borderTop: (theme) => `1px solid ${theme.palette.divider}`,
                        px: 3,
                        py: 2.5,
                        gap: 2,
                    }}
                >
                    <Button
                        onClick={handleCloseDialog}
                        variant="outlined"
                        disabled={isSubmitting}
                        sx={{
                            borderColor: (theme) => theme.palette.mode === 'dark' ? 'grey.700' : 'grey.400',
                            '&:hover': {
                                borderColor: (theme) => theme.palette.mode === 'dark' ? 'grey.600' : 'grey.500',
                                bgcolor: (theme) => theme.palette.mode === 'dark' ? 'grey.800' : 'grey.200',
                            },
                        }}
                    >
                        {t('satellite_database.cancel')}
                    </Button>
                    <Button
                        variant="contained"
                        onClick={handleSubmit}
                        color="success"
                        disabled={isSubmitDisabled || isSubmitting}
                    >
                        {formValues.id ? t('satellite_database.edit') : t('satellite_database.submit')}
                    </Button>
                </DialogActions>
            </Dialog>
            <TransmittersDialog
                open={transmittersDialogOpen}
                onClose={handleCloseTransmitters}
                title={t('satellite_database.edit_transmitters_title', {
                    name: clickedSatellite?.name || clickedSatellite?.norad_id || '',
                })}
                satelliteData={clickedSatellite}
                variant="paper"
            />
        </Box>
    );
});

export default SatelliteTable;
