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
import Box from '@mui/material/Box';
import {DataGrid, gridClasses} from "@mui/x-data-grid";
import Stack from "@mui/material/Stack";
import {Alert, AlertTitle, Button, InputAdornment, TextField, Typography} from "@mui/material";
import {useEffect, useState} from "react";
import { useTranslation } from 'react-i18next';
import DialogTitle from "@mui/material/DialogTitle";
import Dialog from "@mui/material/Dialog";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import WarningAmberOutlinedIcon from '@mui/icons-material/WarningAmberOutlined';
import {useSocket} from "../common/socket.jsx";
import { toast } from '../../utils/toast-with-timestamp.jsx';
import {useDispatch, useSelector} from 'react-redux';
import {
    deleteRotators,
    fetchRotators,
    submitOrEditRotator,
    setOpenDeleteConfirm,
    setOpenAddDialog,
    setFormValues,
    resetFormValues,
} from './rotaror-slice.jsx';
import Paper from "@mui/material/Paper";


export default function AntennaRotatorTable() {
    const {socket} = useSocket();
    const dispatch = useDispatch();
    const [selected, setSelected] = useState([]);
    const [pageSize, setPageSize] = useState(10);
    const { t } = useTranslation('hardware');
    const {
        loading,
        rotators,
        status,
        error,
        openAddDialog,
        openDeleteConfirm,
        formValues
    } = useSelector((state) => state.rotators);
    const isEditing = Boolean(formValues.id);

    const columns = [
        {field: 'name', headerName: t('rotator.name'), flex: 1, minWidth: 150},
        {field: 'host', headerName: t('rotator.host'), flex: 1, minWidth: 150},
        {
            field: 'port',
            headerName: t('rotator.port'),
            type: 'number',
            flex: 1,
            minWidth: 80,
            align: 'right',
            headerAlign: 'right',
            valueFormatter: (value) => {
                return value;
            }
        },
        {field: 'minaz', headerName: t('rotator.min_az'), type: 'number', flex: 1, minWidth: 80},
        {field: 'maxaz', headerName: t('rotator.max_az'), type: 'number', flex: 1, minWidth: 80},
        {field: 'minel', headerName: t('rotator.min_el'), type: 'number', flex: 1, minWidth: 80},
        {field: 'maxel', headerName: t('rotator.max_el'), type: 'number', flex: 1, minWidth: 80},
        {field: 'aztolerance', headerName: t('rotator.az_tolerance'), type: 'number', flex: 1, minWidth: 110},
        {field: 'eltolerance', headerName: t('rotator.el_tolerance'), type: 'number', flex: 1, minWidth: 110},
    ];

    // useEffect(() => {
    //     // Only dispatch if the socket is ready
    //     if (socket) {
    //         dispatch(fetchRotators({socket}));
    //     }
    // }, [dispatch, socket]);

    const handleChange = (e) => {
        const {name, value} = e.target;
        dispatch(setFormValues({...formValues, [name]: value}));
    };

    const handleSubmit = () => {
        dispatch(submitOrEditRotator({socket, formValues}))
            .unwrap()
            .then(() => {
                toast.success(t('rotator.saved_success'));
                setOpenAddDialog(false);
            })
            .catch((err) => {
                toast.error(err.message);
            });
    }

    const validationErrors = {};
    if (!formValues.name?.trim()) validationErrors.name = 'Required';
    if (!formValues.host?.trim()) validationErrors.host = 'Required';
    if (!formValues.port && formValues.port !== 0) {
        validationErrors.port = 'Required';
    } else if (Number(formValues.port) <= 0 || Number(formValues.port) > 65535) {
        validationErrors.port = 'Port must be 1-65535';
    }
    const isEmptyValue = (value) => value === '' || value === null || value === undefined;
    if (isEmptyValue(formValues.minaz)) {
        validationErrors.minaz = 'Required';
    } else if (Number.isNaN(Number(formValues.minaz))) {
        validationErrors.minaz = 'Must be a number';
    }
    if (isEmptyValue(formValues.maxaz)) {
        validationErrors.maxaz = 'Required';
    } else if (Number.isNaN(Number(formValues.maxaz))) {
        validationErrors.maxaz = 'Must be a number';
    }
    if (!isEmptyValue(formValues.minaz)
        && !isEmptyValue(formValues.maxaz)
        && Number(formValues.minaz) > Number(formValues.maxaz)) {
        validationErrors.minaz = 'Min azimuth must be <= max azimuth';
        validationErrors.maxaz = 'Min azimuth must be <= max azimuth';
    }
    if (isEmptyValue(formValues.minel)) {
        validationErrors.minel = 'Required';
    } else if (Number.isNaN(Number(formValues.minel))) {
        validationErrors.minel = 'Must be a number';
    }
    if (isEmptyValue(formValues.maxel)) {
        validationErrors.maxel = 'Required';
    } else if (Number.isNaN(Number(formValues.maxel))) {
        validationErrors.maxel = 'Must be a number';
    }
    if (!isEmptyValue(formValues.minel)
        && !isEmptyValue(formValues.maxel)
        && Number(formValues.minel) > Number(formValues.maxel)) {
        validationErrors.minel = 'Min elevation must be <= max elevation';
        validationErrors.maxel = 'Min elevation must be <= max elevation';
    }
    if (isEmptyValue(formValues.aztolerance)) {
        validationErrors.aztolerance = 'Required';
    } else if (Number.isNaN(Number(formValues.aztolerance))) {
        validationErrors.aztolerance = 'Must be a number';
    } else if (Number(formValues.aztolerance) < 0) {
        validationErrors.aztolerance = 'Must be >= 0';
    }
    if (isEmptyValue(formValues.eltolerance)) {
        validationErrors.eltolerance = 'Required';
    } else if (Number.isNaN(Number(formValues.eltolerance))) {
        validationErrors.eltolerance = 'Must be a number';
    } else if (Number(formValues.eltolerance) < 0) {
        validationErrors.eltolerance = 'Must be >= 0';
    }
    const hasValidationErrors = Object.keys(validationErrors).length > 0;

    const handleDelete = () => {
        dispatch(deleteRotators({socket, selectedIds: selected}))
            .unwrap()
            .then(() => {
                toast.success(t('rotator.deleted_success'));
                dispatch(setOpenDeleteConfirm(false));
            })
            .catch((err) => {
                toast.error(err.message);
            });
    };

    return (
        <Paper elevation={3} sx={{padding: 2, marginTop: 0}}>
            <Alert severity="info">
                <AlertTitle>{t('rotator.title')}</AlertTitle>
                {t('rotator.subtitle')}
            </Alert>
            <Box component="form" sx={{mt: 2}}>
                <Box sx={{width: '100%'}}>
                    <DataGrid
                        loading={loading}
                        rows={rotators}
                        columns={columns}
                        checkboxSelection
                        disableSelectionOnClick
                        onRowSelectionModelChange={(selected) => {
                            setSelected(selected);
                        }}
                        initialState={{
                            pagination: {paginationModel: {pageSize: 5}},
                            sorting: {
                                sortModel: [{field: 'name', sort: 'desc'}],
                            },
                        }}
                        selectionModel={selected}
                        pageSize={pageSize}
                        pageSizeOptions={[5, 10, 25, {value: -1, label: 'All'}]}
                        onPageSizeChange={(newPageSize) => setPageSize(newPageSize)}
                        rowsPerPageOptions={[5, 10, 25]}
                        getRowId={(row) => row.id}
                        localeText={{
                            noRowsLabel: t('rotator.no_rotators')
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
                            '& .MuiDataGrid-overlay': {
                                fontSize: '0.875rem',
                                fontStyle: 'italic',
                                color: 'text.secondary',
                            },
                        }}
                    />
                    <Stack direction="row" spacing={2} style={{marginTop: 15}}>
                        <Button
                            variant="contained"
                            onClick={() => {
                                dispatch(resetFormValues());
                                dispatch(setOpenAddDialog(true));
                            }}
                        >
                            {t('rotator.add')}
                        </Button>
                        <Dialog
                            fullWidth={true}
                            open={openAddDialog}
                            onClose={() => dispatch(setOpenAddDialog(false))}
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
                                {isEditing ? t('rotator.edit_dialog_title') : t('rotator.add_dialog_title')}
                            </DialogTitle>
                            <DialogContent sx={{ bgcolor: 'background.paper', px: 3, py: 3, pt: '1em' }}>
                                <Stack spacing={2} sx={{ mt: 3 }}>
                                    <TextField
                                        name="name"
                                        label={t('rotator.name')}
                                        fullWidth
                                        size="small"
                                        onChange={handleChange}
                                        value={formValues.name}
                                        error={Boolean(validationErrors.name)}
                                        required
                                    />
                                    <TextField
                                        name="host"
                                        label={t('rotator.host')}
                                        fullWidth
                                        size="small"
                                        onChange={handleChange}
                                        value={formValues.host}
                                        error={Boolean(validationErrors.host)}
                                        required
                                    />
                                    <TextField
                                        name="port"
                                        label={t('rotator.port')}
                                        type="number"
                                        fullWidth
                                        size="small"
                                        onChange={handleChange}
                                        value={formValues.port}
                                        error={Boolean(validationErrors.port)}
                                        required
                                    />
                                    <TextField
                                        name="minaz"
                                        label={t('rotator.min_az')}
                                        type="number"
                                        fullWidth
                                        size="small"
                                        onChange={handleChange}
                                        value={formValues.minaz}
                                        error={Boolean(validationErrors.minaz)}
                                        required
                                        InputProps={{ endAdornment: <InputAdornment position="end">°</InputAdornment> }}
                                    />
                                    <TextField
                                        name="maxaz"
                                        label={t('rotator.max_az')}
                                        type="number"
                                        fullWidth
                                        size="small"
                                        onChange={handleChange}
                                        value={formValues.maxaz}
                                        error={Boolean(validationErrors.maxaz)}
                                        required
                                        InputProps={{ endAdornment: <InputAdornment position="end">°</InputAdornment> }}
                                    />
                                    <TextField
                                        name="minel"
                                        label={t('rotator.min_el')}
                                        type="number"
                                        fullWidth
                                        size="small"
                                        onChange={handleChange}
                                        value={formValues.minel}
                                        error={Boolean(validationErrors.minel)}
                                        required
                                        InputProps={{ endAdornment: <InputAdornment position="end">°</InputAdornment> }}
                                    />
                                    <TextField
                                        name="maxel"
                                        label={t('rotator.max_el')}
                                        type="number"
                                        fullWidth
                                        size="small"
                                        onChange={handleChange}
                                        value={formValues.maxel}
                                        error={Boolean(validationErrors.maxel)}
                                        required
                                        InputProps={{ endAdornment: <InputAdornment position="end">°</InputAdornment> }}
                                    />
                                    <Alert severity="warning" sx={{ mt: 0.5 }}>
                                        Tolerance settings control the deadband for rotator movement. Setting these
                                        values too low can cause excessive commands, jitter, or errors on some hardware.
                                        Default safe value is 2°.
                                    </Alert>
                                    <TextField
                                        name="aztolerance"
                                        label={t('rotator.az_tolerance')}
                                        type="number"
                                        fullWidth
                                        size="small"
                                        onChange={handleChange}
                                        value={formValues.aztolerance}
                                        error={Boolean(validationErrors.aztolerance)}
                                        helperText={validationErrors.aztolerance ? validationErrors.aztolerance : 'Lower values may stress some rotators.'}
                                        required
                                        InputProps={{
                                            endAdornment: (
                                                <InputAdornment position="end">
                                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                                        <WarningAmberOutlinedIcon
                                                            fontSize="small"
                                                            color="warning"
                                                            sx={{ opacity: 0.7 }}
                                                        />
                                                        <span>°</span>
                                                    </Box>
                                                </InputAdornment>
                                            )
                                        }}
                                    />
                                    <TextField
                                        name="eltolerance"
                                        label={t('rotator.el_tolerance')}
                                        type="number"
                                        fullWidth
                                        size="small"
                                        onChange={handleChange}
                                        value={formValues.eltolerance}
                                        error={Boolean(validationErrors.eltolerance)}
                                        helperText={validationErrors.eltolerance ? validationErrors.eltolerance : 'Lower values may stress some rotators.'}
                                        required
                                        InputProps={{
                                            endAdornment: (
                                                <InputAdornment position="end">
                                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                                        <WarningAmberOutlinedIcon
                                                            fontSize="small"
                                                            color="warning"
                                                            sx={{ opacity: 0.7 }}
                                                        />
                                                        <span>°</span>
                                                    </Box>
                                                </InputAdornment>
                                            )
                                        }}
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
                                    onClick={() => dispatch(setOpenAddDialog(false))}
                                    variant="outlined"
                                    sx={{
                                        borderColor: (theme) => theme.palette.mode === 'dark' ? 'grey.700' : 'grey.400',
                                        '&:hover': {
                                            borderColor: (theme) => theme.palette.mode === 'dark' ? 'grey.600' : 'grey.500',
                                            bgcolor: (theme) => theme.palette.mode === 'dark' ? 'grey.800' : 'grey.200',
                                        },
                                    }}
                                >
                                    {t('rotator.cancel')}
                                </Button>
                                <Button
                                    color="success"
                                    variant="contained"
                                    onClick={handleSubmit}
                                    disabled={hasValidationErrors}
                                >
                                    {t('rotator.submit')}
                                </Button>
                            </DialogActions>
                        </Dialog>
                        <Button
                            variant="contained"
                            disabled={selected.length !== 1}
                            onClick={() => {
                                const selectedRow = rotators.find(row => row.id === selected[0]);
                                if (selectedRow) {
                                    dispatch(setFormValues(selectedRow));
                                    dispatch(setOpenAddDialog(true));
                                }
                            }}
                        >
                            {t('rotator.edit')}
                        </Button>
                        <Button
                            variant="contained"
                            disabled={selected.length < 1}
                            color="error"
                            onClick={() => dispatch(setOpenDeleteConfirm(true))}
                        >
                            {t('rotator.delete')}
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
                                {t('rotator.confirm_deletion')}
                            </DialogTitle>
                            <DialogContent sx={{ px: 3, pt: 3, pb: 3 }}>
                                <Typography variant="body1" sx={{ mt: 2, mb: 2, color: 'text.primary' }}>
                                    {t('rotator.confirm_delete_message')}
                                </Typography>
                                <Typography variant="body2" sx={{ mb: 2, fontWeight: 600, color: 'text.secondary' }}>
                                    {selected.length === 1 ? 'Rotator to be deleted:' : `${selected.length} Rotators to be deleted:`}
                                </Typography>
                                <Box sx={{
                                    maxHeight: 300,
                                    overflowY: 'auto',
                                    bgcolor: (theme) => theme.palette.mode === 'dark' ? 'grey.900' : 'grey.50',
                                    borderRadius: 1,
                                    border: (theme) => `1px solid ${theme.palette.divider}`,
                                }}>
                                    {selected.map((id, index) => {
                                        const rotator = rotators.find(r => r.id === id);
                                        if (!rotator) return null;
                                        return (
                                            <Box
                                                key={id}
                                                sx={{
                                                    p: 2,
                                                    borderBottom: index < selected.length - 1 ? (theme) => `1px solid ${theme.palette.divider}` : 'none',
                                                }}
                                            >
                                                <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1, color: 'text.primary' }}>
                                                    {rotator.name}
                                                </Typography>
                                                <Box sx={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 1, columnGap: 2 }}>
                                                    <Typography variant="body2" sx={{ fontSize: '0.813rem', color: 'text.secondary', fontWeight: 500 }}>
                                                        Host:
                                                    </Typography>
                                                    <Typography variant="body2" sx={{ fontSize: '0.813rem', color: 'text.primary' }}>
                                                        {rotator.host}:{rotator.port}
                                                    </Typography>

                                                    <Typography variant="body2" sx={{ fontSize: '0.813rem', color: 'text.secondary', fontWeight: 500 }}>
                                                        Azimuth:
                                                    </Typography>
                                                    <Typography variant="body2" sx={{ fontSize: '0.813rem', color: 'text.primary' }}>
                                                        {rotator.minaz}° - {rotator.maxaz}°
                                                    </Typography>

                                                    <Typography variant="body2" sx={{ fontSize: '0.813rem', color: 'text.secondary', fontWeight: 500 }}>
                                                        Elevation:
                                                    </Typography>
                                                    <Typography variant="body2" sx={{ fontSize: '0.813rem', color: 'text.primary' }}>
                                                        {rotator.minel}° - {rotator.maxel}°
                                                    </Typography>
                                                </Box>
                                            </Box>
                                        );
                                    })}
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
                                    {t('rotator.cancel')}
                                </Button>
                                <Button
                                    variant="contained"
                                    onClick={handleDelete}
                                    color="error"
                                    sx={{
                                        minWidth: 100,
                                        textTransform: 'none',
                                        fontWeight: 600,
                                    }}
                                >
                                    {t('rotator.delete')}
                                </Button>
                            </DialogActions>
                        </Dialog>
                    </Stack>
                </Box>
            </Box>
        </Paper>

    );
}
