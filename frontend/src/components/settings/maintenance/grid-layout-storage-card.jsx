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

import React, {useState} from 'react';
import {
    Typography,
    Divider,
    Button,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Alert,
    AlertTitle,
    Backdrop,
    Box,
    CircularProgress
} from '@mui/material';
import Grid from '@mui/material/Grid';
import {useTranslation} from 'react-i18next';
import {gridLayoutStoreName as overviewGridLayoutName} from "../../overview/main-layout.jsx";
import {gridLayoutStoreName as targetGridLayoutName} from "../../target/main-layout.jsx";
import {gridLayoutStoreName as waterfallGridLayoutName} from "../../waterfall/main-layout.jsx";

const GridLayoutStorageCard = () => {
    const {t} = useTranslation('settings');
    const [confirmClearLayoutOpen, setConfirmClearLayoutOpen] = useState(false);
    const [isReloading, setIsReloading] = useState(false);

    const clearLayoutLocalStorage = () => {
        setConfirmClearLayoutOpen(false);
        localStorage.setItem(overviewGridLayoutName, null);
        localStorage.setItem(targetGridLayoutName, null);
        localStorage.setItem(waterfallGridLayoutName, null);

        // Show reload spinner and reload after 1 second
        setIsReloading(true);
        setTimeout(() => {
            window.location.reload();
        }, 1000);
    };

    return (
        <>
            <Typography variant="h6" gutterBottom>
                Grid Layout Storage
            </Typography>
            <Divider sx={{mb: 2}}/>

            <Grid container spacing={2} columns={16}>
                <Grid size={16}>
                    <Alert severity="warning" sx={{mb: 2}}>
                        <AlertTitle>Clear All Grid Layouts</AlertTitle>
                        This will reset all grid layouts below to their defaults. Use individual buttons to clear
                        specific layouts only.
                    </Alert>
                </Grid>

                <Grid size={10}>
                    {t('maintenance.clear_layout')}
                    <Typography variant="body2" color="text.secondary">
                        Clears all grid layouts (all layouts below)
                    </Typography>
                </Grid>
                <Grid size={6}>
                    <Button
                        variant="contained"
                        color="error"
                        onClick={() => setConfirmClearLayoutOpen(true)}
                        fullWidth
                        size="small"
                    >
                        {t('maintenance.clear_layout_button')}
                    </Button>
                </Grid>

                <Grid size={16}>
                    <Divider sx={{my: 2}}/>
                    <Typography variant="body2" color="text.secondary" gutterBottom>
                        Or clear individual layouts:
                    </Typography>
                </Grid>

                <Grid size={10}>
                    Clear Overview Grid Layout
                    <Typography variant="body2" color="text.secondary">
                        Resets the widget layout on the Overview page
                    </Typography>
                </Grid>
                <Grid size={6}>
                    <Button
                        variant="outlined"
                        color="warning"
                        onClick={() => localStorage.setItem(overviewGridLayoutName, null)}
                        fullWidth
                        size="small"
                    >
                        Clear
                    </Button>
                </Grid>

                <Grid size={10}>
                    Clear Target Grid Layout
                    <Typography variant="body2" color="text.secondary">
                        Resets the widget layout on the Target page
                    </Typography>
                </Grid>
                <Grid size={6}>
                    <Button
                        variant="outlined"
                        color="warning"
                        onClick={() => localStorage.setItem(targetGridLayoutName, null)}
                        fullWidth
                        size="small"
                    >
                        Clear
                    </Button>
                </Grid>

                <Grid size={10}>
                    Clear Waterfall Grid Layout
                    <Typography variant="body2" color="text.secondary">
                        Resets the widget layout on the Waterfall page
                    </Typography>
                </Grid>
                <Grid size={6}>
                    <Button
                        variant="outlined"
                        color="warning"
                        onClick={() => localStorage.setItem(waterfallGridLayoutName, null)}
                        fullWidth
                        size="small"
                    >
                        Clear
                    </Button>
                </Grid>
            </Grid>

            {/* Clear Layout Confirmation Dialog */}
            <Dialog
                open={confirmClearLayoutOpen}
                onClose={() => setConfirmClearLayoutOpen(false)}
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
                    Clear All Grid Layouts?
                </DialogTitle>
                <DialogContent sx={{ px: 3, pt: 3, pb: 3 }}>
                    <Alert severity="info" sx={{ mt: 2, mb: 2 }}>
                        <AlertTitle>Local Browser Cache Only</AlertTitle>
                        This will only clear layout preferences stored in your browser's local storage. No backend data
                        will be affected.
                    </Alert>
                    <Typography variant="body1" sx={{ mb: 2, color: 'text.primary' }}>
                        This will reset all widget layouts to their defaults on the following pages:
                    </Typography>
                    <Box sx={{
                        p: 2,
                        bgcolor: (theme) => theme.palette.mode === 'dark' ? 'grey.900' : 'grey.50',
                        borderRadius: 1,
                        border: (theme) => `1px solid ${theme.palette.divider}`,
                    }}>
                        <Typography component="div" variant="body2" sx={{ fontSize: '0.813rem', color: 'text.primary' }}>
                            <ul style={{ margin: 0, paddingLeft: '1.5rem' }}>
                                <li>Overview page</li>
                                <li>Target page</li>
                                <li>Waterfall page</li>
                            </ul>
                        </Typography>
                    </Box>
                    <Alert severity="warning" sx={{ mt: 2 }}>
                        <AlertTitle>Page Refresh Required</AlertTitle>
                        You will need to refresh the page to see the changes.
                    </Alert>
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
                        onClick={() => setConfirmClearLayoutOpen(false)}
                        variant="outlined"
                        color="inherit"
                        sx={{
                            minWidth: 100,
                            textTransform: 'none',
                            fontWeight: 500,
                        }}
                    >
                        Cancel
                    </Button>
                    <Button
                        onClick={clearLayoutLocalStorage}
                        color="error"
                        variant="contained"
                        sx={{
                            minWidth: 100,
                            textTransform: 'none',
                            fontWeight: 600,
                        }}
                    >
                        Clear Layouts
                    </Button>
                </DialogActions>
            </Dialog>

            {/* Reload Spinner Overlay */}
            <Backdrop
                sx={{color: '#fff', zIndex: (theme) => theme.zIndex.modal + 1}}
                open={isReloading}
            >
                <Box sx={{textAlign: 'center'}}>
                    <CircularProgress color="inherit" size={60}/>
                    <Typography variant="h6" sx={{mt: 2}}>
                        Reloading...
                    </Typography>
                </Box>
            </Backdrop>
        </>
    );
};

export default GridLayoutStorageCard;
