import { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
    Alert, Box, Button, Chip, CircularProgress, FormControlLabel, Grid, IconButton, Link, Paper, Stack, Switch,
    TextField, Tooltip, Typography,
} from '@mui/material';
import CurrencyBitcoinRoundedIcon from '@mui/icons-material/CurrencyBitcoinRounded';
import BoltRoundedIcon from '@mui/icons-material/BoltRounded';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import { useSocket } from '../common/socket.jsx';
import { toast } from '../../utils/toast-with-timestamp.jsx';
import { fetchMessages, fetchState, testBitcoinConnection, updateSettings } from './bitlink21-slice.jsx';
import { parseInvoice, timeAgo } from './link-utils.js';

function BitcoinCard({ settings, socket, dispatch, busy }) {
    const btc = settings?.bitcoin || {};
    const [form, setForm] = useState(btc);
    const [test, setTest] = useState(null);
    const [testing, setTesting] = useState(false);
    useEffect(() => { setForm(settings?.bitcoin || {}); }, [settings?.bitcoin]);

    const runTest = async () => {
        setTesting(true);
        setTest(null);
        const res = await dispatch(testBitcoinConnection({ socket, ...form }));
        setTesting(false);
        setTest(res.error ? { ok: false, text: res.payload } : { ok: true, text: `Connected · ${res.payload.chain} · block ${res.payload.blocks}` });
    };

    const save = async () => {
        const res = await dispatch(updateSettings({ socket, bitcoin: form }));
        if (!res.error) toast.success('Bitcoin settings saved');
    };

    return (
        <Paper variant="outlined" sx={{ p: 3, borderRadius: 3 }}>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
                <CurrencyBitcoinRoundedIcon sx={{ color: '#f7931a' }} />
                <Typography variant="h6" sx={{ fontWeight: 700 }}>Bitcoin relay</Typography>
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Signed transactions received over the satellite are broadcast to the Bitcoin network through your node.
            </Typography>
            <Stack spacing={2}>
                <FormControlLabel
                    control={<Switch checked={!!form.relay_enabled} onChange={(e) => setForm({ ...form, relay_enabled: e.target.checked })} />}
                    label="Broadcast received transactions"
                />
                <TextField label="Bitcoin Core RPC URL" size="small" value={form.rpc_url || ''} onChange={(e) => setForm({ ...form, rpc_url: e.target.value })} />
                <Stack direction="row" spacing={2}>
                    <TextField label="RPC user" size="small" sx={{ flex: 1 }} value={form.rpc_user || ''} onChange={(e) => setForm({ ...form, rpc_user: e.target.value })} />
                    <TextField label="RPC password" size="small" type="password" sx={{ flex: 1 }} value={form.rpc_pass || ''} onChange={(e) => setForm({ ...form, rpc_pass: e.target.value })} />
                </Stack>
                <Stack direction="row" spacing={1}>
                    <Button variant="contained" onClick={save} disabled={busy}>Save</Button>
                    <Button variant="outlined" onClick={runTest} disabled={testing} startIcon={testing ? <CircularProgress size={16} /> : null}>Test connection</Button>
                </Stack>
                {test && <Alert severity={test.ok ? 'success' : 'error'} variant="outlined">{test.text}</Alert>}
            </Stack>
        </Paper>
    );
}

function LightningCard({ settings, socket, dispatch, busy }) {
    const [url, setUrl] = useState(settings?.lightning?.lnd_rest_url || '');
    useEffect(() => { setUrl(settings?.lightning?.lnd_rest_url || ''); }, [settings?.lightning?.lnd_rest_url]);
    const save = async () => {
        const res = await dispatch(updateSettings({ socket, lightning: { lnd_rest_url: url } }));
        if (!res.error) toast.success('Lightning settings saved');
    };
    return (
        <Paper variant="outlined" sx={{ p: 3, borderRadius: 3 }}>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
                <BoltRoundedIcon sx={{ color: '#f7931a' }} />
                <Typography variant="h6" sx={{ fontWeight: 700 }}>Lightning</Typography>
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Invoices received over the satellite are listed here. Connect LND to check their payment status
                (LNbits and BTCPay Server support is planned).
            </Typography>
            <Stack spacing={2}>
                <TextField label="LND REST URL" size="small" value={url} placeholder="https://umbrel.local:8080" onChange={(e) => setUrl(e.target.value)} />
                <Box><Button variant="contained" onClick={save} disabled={busy}>Save</Button></Box>
            </Stack>
        </Paper>
    );
}

function TxList({ messages }) {
    const rows = messages.filter((m) => m.payload_type === 1);
    return (
        <Paper variant="outlined" sx={{ p: 3, borderRadius: 3 }}>
            <Typography variant="overline" color="text.secondary">Transactions</Typography>
            {!rows.length && <Typography color="text.secondary" sx={{ mt: 1 }}>None yet.</Typography>}
            <Stack spacing={1.5} sx={{ mt: 1 }}>
                {rows.map((m) => (
                    <Box key={m.id}>
                        <Stack direction="row" spacing={1} alignItems="center">
                            <Chip size="small" label={m.direction === 'tx' ? 'Sent' : 'Received'} />
                            <Typography variant="body2" color="text.secondary">{m.callsign || ''} · {timeAgo(m.created_at)}</Typography>
                            {m.relay_status && <Chip size="small" variant="outlined" label={m.relay_status}
                                color={m.relay_status === 'success' ? 'success' : m.relay_status === 'error' ? 'error' : 'default'} />}
                        </Stack>
                        <Typography variant="caption" sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }} component="div">
                            {m.relay_result?.txid
                                ? <Link href={`https://mempool.space/tx/${m.relay_result.txid}`} target="_blank" rel="noreferrer">{m.relay_result.txid}</Link>
                                : `${m.body_hex?.slice(0, 80) || ''}…`}
                        </Typography>
                        {m.relay_status === 'error' && <Typography variant="caption" color="error">{m.relay_result?.message}</Typography>}
                    </Box>
                ))}
            </Stack>
        </Paper>
    );
}

function InvoiceList({ messages }) {
    const rows = messages.filter((m) => m.payload_type === 2 && m.body_text);
    return (
        <Paper variant="outlined" sx={{ p: 3, borderRadius: 3 }}>
            <Typography variant="overline" color="text.secondary">Invoices</Typography>
            {!rows.length && <Typography color="text.secondary" sx={{ mt: 1 }}>None yet.</Typography>}
            <Stack spacing={1.5} sx={{ mt: 1 }}>
                {rows.map((m) => {
                    const inv = parseInvoice(m.body_text);
                    return (
                        <Stack key={m.id} direction="row" spacing={1} alignItems="center">
                            <Typography sx={{ fontWeight: 700, minWidth: 120 }}>
                                ⚡ {inv?.sats !== null && inv?.sats !== undefined ? `${inv.sats.toLocaleString()} sats` : 'any amount'}
                            </Typography>
                            <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
                                {m.direction === 'tx' ? 'Sent' : `From ${m.callsign || 'unknown'}`} · {inv?.network} · {timeAgo(m.created_at)}
                            </Typography>
                            <Tooltip title="Copy invoice">
                                <IconButton size="small" onClick={() => navigator.clipboard?.writeText(m.body_text)}>
                                    <ContentCopyRoundedIcon fontSize="small" />
                                </IconButton>
                            </Tooltip>
                        </Stack>
                    );
                })}
            </Stack>
        </Paper>
    );
}

export default function PaymentsPage() {
    const dispatch = useDispatch();
    const { socket } = useSocket();
    const { settings, messages, busy } = useSelector((state) => state.bitlink21);

    useEffect(() => {
        if (!socket) return;
        dispatch(fetchState({ socket }));
        dispatch(fetchMessages({ socket, limit: 500 }));
    }, [socket, dispatch]);

    return (
        <Box sx={{ p: { xs: 1.5, md: 3 }, maxWidth: 1400, mx: 'auto' }}>
            <Typography variant="h4" sx={{ fontWeight: 800, mb: 2 }}>Bitcoin &amp; Lightning</Typography>
            <Grid container spacing={2}>
                <Grid size={{ xs: 12, md: 6 }}>
                    <Stack spacing={2}>
                        <BitcoinCard settings={settings} socket={socket} dispatch={dispatch} busy={busy} />
                        <TxList messages={messages} />
                    </Stack>
                </Grid>
                <Grid size={{ xs: 12, md: 6 }}>
                    <Stack spacing={2}>
                        <LightningCard settings={settings} socket={socket} dispatch={dispatch} busy={busy} />
                        <InvoiceList messages={messages} />
                    </Stack>
                </Grid>
            </Grid>
        </Box>
    );
}
