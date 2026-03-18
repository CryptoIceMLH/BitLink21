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

import React, { useState } from 'react';
import { Typography, Divider, Button, Dialog, DialogTitle, DialogContent, DialogActions, Alert, AlertTitle, CircularProgress } from '@mui/material';
import Grid from '@mui/material/Grid';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import { useSocket } from "../../common/socket.jsx";
import { useTranslation } from 'react-i18next';

const ServiceControlCard = () => {
    const { socket } = useSocket();
    const { t } = useTranslation('settings');
    const [isRestarting, setIsRestarting] = useState(false);
    const [restartMessage, setRestartMessage] = useState('');
    const [confirmRestartOpen, setConfirmRestartOpen] = useState(false);

    const handleServiceRestart = () => {
        setConfirmRestartOpen(false);
        setIsRestarting(true);
        setRestartMessage('Initiating service restart...');

        socket.emit("service_control", "restart_service", null, (response) => {
            if (response.status === "success") {
                setRestartMessage('Service is restarting. All connections will be terminated.');

                // Start countdown
                let countdown = 15;
                const countdownInterval = setInterval(() => {
                    setRestartMessage(`Service restarting... Page will reload in ${countdown} seconds`);
                    countdown--;

                    if (countdown <= 0) {
                        clearInterval(countdownInterval);
                    }
                }, 1000);
            } else {
                console.error('Service restart failed:', response.error);
                setRestartMessage(`Failed to restart service: ${response.error}`);
                setIsRestarting(false);
            }
        });
    };

    return (
        <>
            <Typography variant="h6" gutterBottom>
                Service Control
            </Typography>
            <Divider sx={{ mb: 2 }} />

                <Alert severity="warning" sx={{ mb: 2 }}>
                    <AlertTitle>{t('maintenance.service_control_title')}</AlertTitle>
                    {t('maintenance.service_control_subtitle')}
                </Alert>

                <Grid container spacing={2} columns={16}>
                    <Grid size={10}>
                        {t('maintenance.restart_service')}
                        <Typography variant="body2" color="text.secondary">
                            {t('maintenance.restart_service_description')}
                        </Typography>
                    </Grid>
                    <Grid size={6} sx={{ display: 'flex', alignItems: 'center' }}>
                        <Button
                            variant="contained"
                            color="error"
                            startIcon={isRestarting ? <CircularProgress size={20} color="inherit" /> : <RestartAltIcon />}
                            onClick={() => setConfirmRestartOpen(true)}
                            disabled={isRestarting}
                            fullWidth
                            size="small"
                        >
                            {isRestarting ? t('maintenance.restarting') : t('maintenance.restart_service_button')}
                        </Button>
                    </Grid>

                    {restartMessage && (
                        <Grid size={16}>
                            <Alert
                                severity={restartMessage.includes('Failed') ? "error" : "warning"}
                                sx={{ mt: 1 }}
                            >
                                {restartMessage}
                            </Alert>
                        </Grid>
                    )}
                </Grid>

            {/* Service Restart Confirmation Dialog */}
            <Dialog open={confirmRestartOpen} onClose={() => setConfirmRestartOpen(false)}>
                <DialogTitle>{t('maintenance.confirm_restart_title')}</DialogTitle>
                <DialogContent>
                    <Typography paragraph>
                        {t('maintenance.confirm_restart_message')}
                    </Typography>
                    <ul>
                        <li>{t('maintenance.restart_item_1')}</li>
                        <li>{t('maintenance.restart_item_2')}</li>
                        <li>{t('maintenance.restart_item_3')}</li>
                        <li>{t('maintenance.restart_item_4')}</li>
                        <li>{t('maintenance.restart_item_5')}</li>
                        <li>{t('maintenance.restart_item_6')}</li>
                    </ul>
                    <Typography paragraph>
                        {t('maintenance.confirm_restart_question')}
                    </Typography>

                    <Alert severity="info" sx={{ mt: 2 }}>
                        <AlertTitle>{t('maintenance.deployment_note')}</AlertTitle>
                        <Typography variant="body2">
                            <strong>Docker deployment:</strong> {t('maintenance.deployment_docker')}
                        </Typography>
                        <Typography variant="body2">
                            <strong>Standalone/Development deployment:</strong> {t('maintenance.deployment_standalone')}
                        </Typography>
                    </Alert>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setConfirmRestartOpen(false)}>{t('maintenance.cancel')}</Button>
                    <Button onClick={handleServiceRestart} color="error" variant="contained">
                        {t('maintenance.yes_restart')}
                    </Button>
                </DialogActions>
            </Dialog>
        </>
    );
};

export default ServiceControlCard;
