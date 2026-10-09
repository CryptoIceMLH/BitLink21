import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Alert, Box, Button, Grid, Stack, Tab, Tabs, Typography } from '@mui/material';
import TuneRoundedIcon from '@mui/icons-material/TuneRounded';
import { useSocket } from '../common/socket.jsx';
import { toast } from '../../utils/toast-with-timestamp.jsx';
import {
    calibrateRx, clearError, deleteFile, deleteMessage, fetchFiles, fetchMessages, fetchState, sendFile, sendMessage, startStation,
    stopStation, updateSettings,
} from './bitlink21-slice.jsx';
import LinkStatus, { linkSteps } from './link-status.jsx';
import LinkActivity from './link-activity.jsx';
import LinkChannel from './link-channel.jsx';
import LinkWideband from './link-wideband.jsx';
import LinkComposer from './link-composer.jsx';
import LinkFeed from './link-feed.jsx';
import LinkAdvanced from './link-advanced.jsx';
import LinkSetup from './link-setup.jsx';

export default function LinkPage() {
    const dispatch = useDispatch();
    const { socket } = useSocket();
    const bl = useSelector((state) => state.bitlink21);
    const {
        loaded, settings, plan: nbPlan, widebandPlan, widebandOptions, modes, stationRunning, status, messages, files,
        txProgress, busy, lastError, stationError,
    } = bl;
    const wideband = settings?.link_mode === 'wideband';
    const plan = wideband ? widebandPlan : nbPlan;
    const [advancedOpen, setAdvancedOpen] = useState(false);
    const [sending, setSending] = useState(false);
    const autoStarted = useRef(false);

    useEffect(() => {
        if (!socket) return;
        dispatch(fetchState({ socket }));
        dispatch(fetchMessages({ socket, limit: 200 }));
        dispatch(fetchFiles({ socket }));
    }, [socket, dispatch]);

    // "Boom it sets": once set up, opening the page brings the radio up
    useEffect(() => {
        if (!socket || !loaded || autoStarted.current) return;
        if (settings?.setup_done && settings?.auto_start && !stationRunning) {
            autoStarted.current = true;
            dispatch(startStation({ socket }));
        }
    }, [socket, loaded, settings, stationRunning, dispatch]);

    useEffect(() => {
        if (lastError) {
            toast.error(lastError, { autoClose: 8000 });
            dispatch(clearError());
        }
    }, [lastError, dispatch]);

    const apply = useCallback((profileChanges) => {
        dispatch(updateSettings({ socket, profile: profileChanges }));
    }, [dispatch, socket]);

    const send = useCallback(async (msg) => {
        setSending(true);
        const res = await dispatch(sendMessage({ socket, ...msg }));
        setSending(false);
        return !res.error;
    }, [dispatch, socket]);

    const applyWideband = useCallback((changes) => {
        dispatch(updateSettings({ socket, wideband: changes }));
    }, [dispatch, socket]);

    const setLinkMode = useCallback((mode) => {
        dispatch(updateSettings({ socket, link_mode: mode }));
    }, [dispatch, socket]);

    const sendFileCb = useCallback(async (f) => {
        setSending(true);
        const res = await dispatch(sendFile({ socket, ...f }));
        setSending(false);
        return !res.error;
    }, [dispatch, socket]);

    const save = async (changes) => {
        const res = await dispatch(updateSettings({ socket, ...changes }));
        if (!res.error) toast.success('Saved');
    };

    const onDeleteMessage = useCallback((id) => dispatch(deleteMessage({ socket, id })), [dispatch, socket]);
    const onDeleteFile = useCallback((id) => dispatch(deleteFile({ socket, id })), [dispatch, socket]);

    const downloadFile = useCallback((file) => {
        socket.emit('data_request', 'bitlink21:get_file', { id: file.id }, (res) => {
            if (!res?.success) {
                toast.error(res?.error || 'Download failed');
                return;
            }
            const bytes = Uint8Array.from(atob(res.data.data_b64), (c) => c.charCodeAt(0));
            const url = URL.createObjectURL(new Blob([bytes]));
            const a = document.createElement('a');
            a.href = url;
            a.download = res.data.name;
            a.click();
            URL.revokeObjectURL(url);
        });
    }, [socket]);

    const sendingMsg = messages.find((m) => m.direction === 'tx' && m.status === 'sending');
    const steps = linkSteps({ stationRunning, status, settings, plan, busy, stationError });
    // Same object while the state is unchanged, so the composer does not
    // re-render on every receiver status
    const readyState = useMemo(() => steps.ready, [steps.ready.state, steps.ready.detail]);

    if (!loaded) {
        return <Box sx={{ p: 4 }}><Typography color="text.secondary">Connecting…</Typography></Box>;
    }

    return (
        <Box sx={{ p: { xs: 1.5, md: 3 }, maxWidth: 1400, mx: 'auto' }}>
            <Stack direction="row" alignItems="center" sx={{ mb: 2 }}>
                <Box sx={{ flex: 1 }}>
                    <Typography variant="h4" sx={{ fontWeight: 800 }}>Link</Typography>
                    <Typography variant="body2" color="text.secondary">
                        {settings?.callsign ? `${settings.callsign} · ` : ''}QO-100 {wideband ? 'wideband · DVB-S2 (experimental)' : 'narrowband'}
                    </Typography>
                </Box>
                {!stationRunning && settings?.setup_done && (
                    <Button variant="outlined" onClick={() => dispatch(startStation({ socket }))} disabled={busy} sx={{ mr: 1 }}>
                        Start radio
                    </Button>
                )}
                <Button startIcon={<TuneRoundedIcon />} onClick={() => setAdvancedOpen(true)}>Advanced</Button>
            </Stack>

            <Tabs
                value={wideband ? 'wideband' : 'narrowband'}
                onChange={(_, v) => setLinkMode(v)}
                sx={{ mb: 2, minHeight: 36 }}
            >
                <Tab value="narrowband" label="Narrowband · HSModem" sx={{ minHeight: 36 }} disabled={busy} />
                <Tab value="wideband" label="Experimental · Wideband DVB-S2" sx={{ minHeight: 36 }} disabled={busy} />
            </Tabs>

            <LinkStatus stationRunning={stationRunning} status={status} settings={settings} plan={plan} busy={busy} stationError={stationError} />

            {stationRunning && (
                <Box sx={{ mt: 2 }}>
                    <LinkActivity status={status} transmitting={!!sendingMsg} txProgress={sendingMsg ? txProgress[sendingMsg.id] : null} />
                </Box>
            )}

            {plan?.warnings?.length > 0 && (
                <Alert severity="warning" variant="outlined" sx={{ mt: 2 }}>{plan.warnings.join(' ')}</Alert>
            )}

            <Grid container spacing={2} sx={{ mt: 0.5 }}>
                <Grid size={{ xs: 12, lg: 6 }}>
                    <Stack spacing={2}>
                        {wideband ? (
                            <LinkWideband
                                wideband={settings?.wideband}
                                plan={widebandPlan}
                                options={widebandOptions}
                                correctionHz={settings?.last_lnb_correction_hz}
                                busy={busy}
                                onApply={applyWideband}
                            />
                        ) : (
                            <LinkChannel profile={settings?.profile} plan={nbPlan} modes={modes} busy={busy} onApply={apply} />
                        )}
                        <LinkComposer
                            settings={settings}
                            modes={modes}
                            profile={settings?.profile}
                            widebandPlan={wideband ? widebandPlan : null}
                            readyState={readyState}
                            sending={sending}
                            onSend={send}
                            onSendFile={sendFileCb}
                        />
                    </Stack>
                </Grid>
                <Grid size={{ xs: 12, lg: 6 }}>
                    <Box sx={{ maxHeight: { lg: 'calc(100vh - 260px)' }, overflowY: { lg: 'auto' }, pr: { lg: 1 } }}>
                        <LinkFeed
                            messages={messages}
                            files={files}
                            txProgress={txProgress}
                            onDelete={onDeleteMessage}
                            onDownloadFile={downloadFile}
                            onDeleteFile={onDeleteFile}
                        />
                    </Box>
                </Grid>
            </Grid>

            <LinkAdvanced
                open={advancedOpen}
                onClose={() => setAdvancedOpen(false)}
                settings={settings}
                plan={nbPlan}
                status={status}
                modes={modes}
                stationRunning={stationRunning}
                busy={busy}
                onSave={save}
                onStart={() => dispatch(startStation({ socket }))}
                onStop={() => dispatch(stopStation({ socket }))}
                onCalibrate={() => dispatch(calibrateRx({ socket }))}
            />

            <LinkSetup
                open={!!settings && !settings.setup_done}
                settings={settings}
                busy={busy}
                onFinish={async (values) => {
                    const res = await dispatch(updateSettings({ socket, ...values }));
                    if (!res.error) dispatch(startStation({ socket }));
                }}
            />
        </Box>
    );
}
