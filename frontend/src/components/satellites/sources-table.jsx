
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
import {useEffect, useState} from 'react';
import {DataGrid, gridClasses} from '@mui/x-data-grid';
import {
    Alert,
    AlertTitle,
    Box,
    Button,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    TextField,
    Stack, Select, MenuItem, FormControl, InputLabel, Typography,
} from "@mui/material";
import { useTranslation } from 'react-i18next';
import {useDispatch, useSelector} from 'react-redux';
import {fetchTLESources,  submitOrEditTLESource, deleteTLESources} from './sources-slice.jsx';
import {betterDateTimes} from "../common/common.jsx";
import { toast } from '../../utils/toast-with-timestamp.jsx';
import {useSocket} from "../common/socket.jsx";
import {setFormValues, setOpenAddDialog, setOpenDeleteConfirm, setSelected} from "./sources-slice.jsx"
import SynchronizeTLEsCard from "./sychronize-card.jsx";

const paginationModel = {page: 0, pageSize: 10};

export default function SourcesTable() {
    const dispatch = useDispatch();
    const {socket} = useSocket();
    const { t } = useTranslation('satellites');
    const {tleSources, loading, formValues, openDeleteConfirm, openAddDialog, selected} = useSelector((state) => state.tleSources);

    // Get timezone preference
    const timezone = useSelector((state) => {
        const tzPref = state.preferences?.preferences?.find(p => p.name === 'timezone');
        return tzPref?.value || 'UTC';
    });

    const columns = [
        {field: 'name', headerName: t('tle_sources.name'), width: 150},
        {field: 'url', headerName: t('tle_sources.url'), flex: 2},
        {field: 'format', headerName: t('tle_sources.format'), width: 90},
        {
            field: 'added',
            headerName: t('tle_sources.added'),
            flex: 1,
            align: 'right',
            headerAlign: 'right',
            width: 100,
            renderCell: (params) => {
                return betterDateTimes(params.value, timezone);
            }
        },
        {
            field: 'updated',
            headerName: t('tle_sources.updated'),
            flex: 1,
            width: 100,
            align: 'right',
            headerAlign: 'right',
            renderCell: (params) => {
                return betterDateTimes(params.value, timezone);
            }
        },
    ];
    const defaultFormValues = {
        id: null,
        name: '',
        url: '',
        format: '3le',
    };

    const handleAddClick = () => {
        dispatch(setFormValues(defaultFormValues));
        dispatch(setOpenAddDialog(true));
    };

    const handleClose = () => {
        dispatch(setOpenAddDialog(false));
    };

    const handleInputChange = (e) => {
        const {name, value} = e.target;
        dispatch(setFormValues({...formValues, [name]: value}));
    };

    const handleEditClick = (e) => {
        const singleRowId = selected[0];
        dispatch(setFormValues({...tleSources.find(r => r.id === singleRowId), id: singleRowId}));
        dispatch(setOpenAddDialog(true));
    };

    const handleDeleteClick = () => {
        dispatch(deleteTLESources({socket, selectedIds: selected}))
            .unwrap()
            .then((data) => {
                toast.success(data.message, {
                    autoClose: 4000,
                })
            })
            .catch((error) => {
                toast.error(t('tle_sources.failed_delete') + ": " + error, {
                    autoClose: 5000,
                })
            })
        dispatch(setOpenDeleteConfirm(false));
    };

    const handleSubmit = () => {
        if (hasValidationErrors) {
            return;
        }
        if (formValues.id === null) {
            dispatch(submitOrEditTLESource({socket, formValues}))
                .unwrap()
                .then(() => {
                    toast.success(t('tle_sources.added_success'), {
                        autoClose: 4000,
                    })
                })
                .catch((error) => {
                    toast.error(t('tle_sources.failed_add') + ": " + error)
                });
        } else {
            dispatch(submitOrEditTLESource({socket, formValues}))
                .unwrap()
                .then(() => {
                    toast.success(t('tle_sources.updated_success'), {
                        autoClose: 4000,
                    })
                })
                .catch((error) => {
                    toast.error(t('tle_sources.failed_update') + ": " + error)
                });
        }
        dispatch(setOpenAddDialog(false));
    };

    const validationErrors = {};
    if (!String(formValues.name || '').trim()) validationErrors.name = 'Required';
    if (!String(formValues.url || '').trim()) {
        validationErrors.url = 'Required';
    } else {
        try {
            const parsedUrl = new URL(formValues.url);
            if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
                validationErrors.url = 'Must be http or https URL';
            }
        } catch {
            validationErrors.url = 'Invalid URL';
        }
    }
    if (!String(formValues.format || '').trim()) validationErrors.format = 'Required';
    const hasValidationErrors = Object.keys(validationErrors).length > 0;

    // useEffect(() => {
    //     dispatch(fetchTLESources({socket}));
    // }, [dispatch]);

    return (
        <Box sx={{width: '100%', marginTop: 0}}>
            <Alert severity="info">
                <AlertTitle>{t('tle_sources.title')}</AlertTitle>
                {t('tle_sources.subtitle')}
            </Alert>
            <SynchronizeTLEsCard/>
            <Box sx={{marginTop: 4}}>
                <DataGrid
                    loading={loading}
                    rows={tleSources}
                    columns={columns}
                    initialState={{pagination: {paginationModel}}}
                    pageSizeOptions={[5, 10]}
                    checkboxSelection={true}
                    onRowSelectionModelChange={(selected) => {
                        dispatch(setSelected(selected));
                    }}
                    sx={{
                        border: 0,
                        marginTop: 2,
                        [`& .${gridClasses.cell}:focus, & .${gridClasses.cell}:focus-within`]: {
                            outline: 'none',
                        },
                        [`& .${gridClasses.columnHeader}:focus, & .${gridClasses.columnHeader}:focus-within`]:
                            {
                                outline: 'none',
                            },
                    }}
                />
                <Stack direction="row" spacing={2} sx={{marginTop: 2}}>
                    <Button variant="contained" onClick={handleAddClick}>
                        {t('tle_sources.add')}
                    </Button>
                    <Button variant="contained" disabled={selected.length !== 1} onClick={handleEditClick}>
                        {t('tle_sources.edit')}
                    </Button>
                    <Button variant="contained" color="error" disabled={selected.length < 1}
                            onClick={() => dispatch(setOpenDeleteConfirm(true))}>
                        {t('tle_sources.delete')}
                    </Button>
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
                            {t('tle_sources.confirm_deletion')}
                        </DialogTitle>
                        <DialogContent sx={{ px: 3, pt: 3, pb: 3 }}>
                            <Typography variant="body1" sx={{ mt: 2, mb: 2, color: 'text.primary' }}>
                                {t('tle_sources.confirm_delete_intro')}
                            </Typography>
                            <Typography variant="body2" sx={{ mb: 2, fontWeight: 600, color: 'text.secondary' }}>
                                {selected.length === 1 ? 'TLE source to be deleted:' : `${selected.length} TLE sources to be deleted:`}
                            </Typography>
                            <Box sx={{
                                maxHeight: 300,
                                overflowY: 'auto',
                                bgcolor: (theme) => theme.palette.mode === 'dark' ? 'grey.900' : 'grey.50',
                                borderRadius: 1,
                                border: (theme) => `1px solid ${theme.palette.divider}`,
                            }}>
                                {selected.map((id, index) => {
                                    const source = tleSources.find(s => s.id === id);
                                    if (!source) return null;
                                    return (
                                        <Box
                                            key={id}
                                            sx={{
                                                p: 2,
                                                borderBottom: index < selected.length - 1 ? (theme) => `1px solid ${theme.palette.divider}` : 'none',
                                            }}
                                        >
                                            <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1, color: 'text.primary' }}>
                                                {source.name}
                                            </Typography>
                                            <Box sx={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 1, columnGap: 2 }}>
                                                <Typography variant="body2" sx={{ fontSize: '0.813rem', color: 'text.secondary', fontWeight: 500 }}>
                                                    URL:
                                                </Typography>
                                                <Typography variant="body2" sx={{ fontSize: '0.813rem', color: 'text.primary', wordBreak: 'break-all' }}>
                                                    {source.url}
                                                </Typography>

                                                <Typography variant="body2" sx={{ fontSize: '0.813rem', color: 'text.secondary', fontWeight: 500 }}>
                                                    Format:
                                                </Typography>
                                                <Typography variant="body2" sx={{ fontSize: '0.813rem', color: 'text.primary' }}>
                                                    {source.format}
                                                </Typography>

                                                <Typography variant="body2" sx={{ fontSize: '0.813rem', color: 'text.secondary', fontWeight: 500 }}>
                                                    Added:
                                                </Typography>
                                                <Typography variant="body2" sx={{ fontSize: '0.813rem', color: 'text.primary' }}>
                                                    {betterDateTimes(source.added, timezone)}
                                                </Typography>
                                            </Box>
                                        </Box>
                                    );
                                })}
                            </Box>
                            <Box sx={{ mt: 2, p: 2, bgcolor: (theme) => theme.palette.mode === 'dark' ? 'grey.900' : 'grey.50', borderRadius: 1 }}>
                                <Typography variant="body2" sx={{ fontSize: '0.813rem', color: 'warning.main', fontWeight: 500, mb: 1 }}>
                                    {t('tle_sources.cannot_undo')}
                                </Typography>
                                <Typography component="div" variant="body2" sx={{ fontSize: '0.813rem', color: 'text.secondary' }}>
                                    <ul style={{ margin: 0, paddingLeft: '1.5rem' }}>
                                        <li>{t('tle_sources.delete_item_1')}</li>
                                        <li>{t('tle_sources.delete_item_2')}</li>
                                        <li>{t('tle_sources.delete_item_3')}</li>
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
                                {t('tle_sources.cancel')}
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
                                {t('tle_sources.delete')}
                            </Button>
                        </DialogActions>
                    </Dialog>
                </Stack>
                <Dialog
                    open={openAddDialog}
                    onClose={handleClose}
                    fullWidth
                    maxWidth="sm"
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
                        {formValues.id ? t('tle_sources.dialog_title_edit') : t('tle_sources.dialog_title_add')}
                    </DialogTitle>
                    <DialogContent sx={{ bgcolor: 'background.paper', px: 3, py: 3 }}>
                        <Stack spacing={2} sx={{ mt: 3 }}>
                            <Alert severity="warning" sx={{marginBottom: 2}}>
                                <AlertTitle>{t('tle_sources.performance_notice')}</AlertTitle>
                                {t('tle_sources.performance_warning')}
                            </Alert>
                            <TextField
                                label={t('tle_sources.name')}
                                name="name"
                                value={formValues.name}
                                onChange={handleInputChange}
                                size="small"
                                fullWidth
                                error={Boolean(validationErrors.name)}
                            />
                            <TextField
                                label={t('tle_sources.url')}
                                name="url"
                                value={formValues.url}
                                onChange={handleInputChange}
                                size="small"
                                fullWidth
                                error={Boolean(validationErrors.url)}
                            />
                            <FormControl fullWidth size="small" error={Boolean(validationErrors.format)}>
                                <InputLabel id="format-label">{t('tle_sources.format')}</InputLabel>
                                <Select
                                    label={t('tle_sources.format')}
                                    name="format"
                                    value={formValues.format || ''}
                                    onChange={handleInputChange}
                                    size="small"
                                >
                                    <MenuItem value="3le">3LE</MenuItem>
                                </Select>
                            </FormControl>
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
                            onClick={handleClose}
                            variant="outlined"
                            sx={{
                                borderColor: (theme) => theme.palette.mode === 'dark' ? 'grey.700' : 'grey.400',
                                '&:hover': {
                                    borderColor: (theme) => theme.palette.mode === 'dark' ? 'grey.600' : 'grey.500',
                                    bgcolor: (theme) => theme.palette.mode === 'dark' ? 'grey.800' : 'grey.200',
                                },
                            }}
                        >
                            {t('tle_sources.cancel')}
                        </Button>
                        <Button
                            variant="contained"
                            onClick={handleSubmit}
                            disabled={hasValidationErrors}
                                color="success">{formValues.id ? t('tle_sources.edit') : t('tle_sources.submit')}</Button>
                    </DialogActions>
                </Dialog>
            </Box>
        </Box>
    );
}
