import { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
    Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, Grid,
    IconButton, Link, Paper, Stack, Switch, TextField, Tooltip, Typography,
} from '@mui/material';
import CurrencyBitcoinRoundedIcon from '@mui/icons-material/CurrencyBitcoinRounded';
import BoltRoundedIcon from '@mui/icons-material/BoltRounded';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import { useSocket } from '../common/socket.jsx';
import { toast } from '../../utils/toast-with-timestamp.jsx';
import {
    fetchMessages, fetchState, lightningConnect, lightningInfo, lightningPay, lightningRequest, sendMessage,
    testBitcoinConnection, updateSettings,
} from './bitlink21-slice.jsx';
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

const nodeText = (info) => `Connected · ${info.alias || 'LND'} · ${info.network || ''} · ${info.active_channels} channel${info.active_channels === 1 ? '' : 's'} · ${(info.spendable_sat || 0).toLocaleString()} sats spendable${info.synced ? '' : ' · not synced yet'}`;

function LightningCard({ settings, socket, dispatch }) {
    const ln = settings?.lightning || {};
    const [link, setLink] = useState('');
    const [manual, setManual] = useState(false);
    const [restUrl, setRestUrl] = useState(ln.lnd_rest_url || '');
    const [macaroon, setMacaroon] = useState('');
    const [state, setState] = useState(null); // {ok, text}
    const [working, setWorking] = useState(false);
    const [amount, setAmount] = useState('');
    const [memo, setMemo] = useState('');

    useEffect(() => { setRestUrl(ln.lnd_rest_url || ''); }, [ln.lnd_rest_url]);
    useEffect(() => {
        if (!socket || !ln.macaroon_set) return;
        dispatch(lightningInfo({ socket })).then((res) => setState(res.error ? { ok: false, text: res.payload } : { ok: true, text: nodeText(res.payload) }));
    }, [socket, dispatch, ln.macaroon_set]);

    const connect = async () => {
        setWorking(true);
        const res = await dispatch(lightningConnect({ socket, ...(manual ? { lnd_rest_url: restUrl, macaroon_hex: macaroon } : { lndconnect: link }) }));
        setWorking(false);
        if (res.error) {
            setState({ ok: false, text: res.payload });
            return;
        }
        setState({ ok: true, text: nodeText(res.payload) + (res.payload.cert_pinned ? '' : ' · certificate not pinned') });
        setLink('');
        setMacaroon('');
        dispatch(fetchState({ socket }));
        toast.success('LND connected');
    };

    const request = async () => {
        setWorking(true);
        const res = await dispatch(lightningRequest({ socket, amount_sat: Number(amount), memo }));
        setWorking(false);
        if (res.error) toast.error(res.payload);
        else {
            toast.success(`Invoice for ${Number(amount).toLocaleString()} sats sent over the satellite`);
            setAmount('');
            setMemo('');
        }
    };

    return (
        <Paper variant="outlined" sx={{ p: 3, borderRadius: 3 }}>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
                <BoltRoundedIcon sx={{ color: '#f7931a' }} />
                <Typography variant="h6" sx={{ fontWeight: 700 }}>Lightning</Typography>
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Connect your LND node to pay invoices that arrive over the satellite and to send your own.
                Nothing is ever paid without you pressing Pay.
            </Typography>
            <Stack spacing={2}>
                {manual ? (
                    <>
                        <TextField label="LND REST URL" size="small" value={restUrl} placeholder="https://umbrel.local:8080" onChange={(e) => setRestUrl(e.target.value)} />
                        <TextField label="Macaroon (hex)" size="small" type="password" value={macaroon}
                            placeholder={ln.macaroon_set ? 'saved · paste to replace' : 'admin.macaroon as hex'} onChange={(e) => setMacaroon(e.target.value)} />
                    </>
                ) : (
                    <TextField label="lndconnect link" size="small" value={link} type="password"
                        placeholder={ln.macaroon_set ? 'saved · paste a new link to replace' : 'lndconnect://…'}
                        helperText="Umbrel: Lightning Node app → Connect wallet → a REST (local network) option → copy the lndconnect link"
                        onChange={(e) => setLink(e.target.value)} />
                )}
                <Stack direction="row" spacing={1} alignItems="center">
                    <Button variant="contained" onClick={connect} disabled={working || (manual ? !restUrl : !link)}
                        startIcon={working ? <CircularProgress size={16} /> : null}>Connect</Button>
                    <Link component="button" variant="body2" onClick={() => setManual(!manual)}>
                        {manual ? 'Use an lndconnect link' : 'Enter URL and macaroon instead'}
                    </Link>
                </Stack>
                {state && <Alert severity={state.ok ? 'success' : 'error'} variant="outlined">{state.text}</Alert>}
                {ln.macaroon_set && (
                    <Box>
                        <Typography variant="overline" color="text.secondary">Request a payment</Typography>
                        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mt: 0.5 }}>
                            <TextField label="Sats" size="small" type="number" value={amount} sx={{ width: { sm: 130 } }}
                                onChange={(e) => setAmount(e.target.value)} />
                            <TextField label="What for (optional)" size="small" value={memo} sx={{ flex: 1 }}
                                onChange={(e) => setMemo(e.target.value)} />
                            <Button variant="outlined" onClick={request} disabled={working || !(Number(amount) > 0)}>Send invoice</Button>
                        </Stack>
                        <Typography variant="caption" color="text.secondary">
                            Your node creates the invoice and BitLink21 sends it over the satellite. It shows as paid here once your node has the payment.
                        </Typography>
                    </Box>
                )}
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

const feeLimit = (sats) => Math.max(10, Math.ceil(sats * 0.01));
const INVOICE_STATUS = {
    unpaid: { label: 'Unpaid', color: 'default' },
    paying: { label: 'Paying…', color: 'warning' },
    paid: { label: 'Paid', color: 'success' },
    pay_failed: { label: 'Payment failed', color: 'error' },
    expired: { label: 'Expired', color: 'default' },
};

function PayDialog({ msg, onClose, socket, dispatch }) {
    const info = msg?.relay_result || {};
    const fixed = info.amount_sat > 0;
    const [amount, setAmount] = useState('');
    const [paying, setPaying] = useState(false);
    const sats = fixed ? info.amount_sat : Number(amount);
    const pay = async () => {
        setPaying(true);
        const res = await dispatch(lightningPay({ socket, id: msg.id, ...(fixed ? {} : { amount_sat: sats }) }));
        setPaying(false);
        if (res.error) toast.error(res.payload);
        else if (res.payload.paid) toast.success(`Paid ${res.payload.amount_sat.toLocaleString()} sats (fee ${res.payload.fee_sat} sats)`);
        else toast.error(`Payment failed: ${res.payload.reason}`);
        onClose();
    };
    return (
        <Dialog open={!!msg} onClose={paying ? undefined : onClose} maxWidth="xs" fullWidth>
            <DialogTitle>Pay this invoice?</DialogTitle>
            <DialogContent>
                <Stack spacing={1}>
                    {fixed
                        ? <Typography variant="h5" sx={{ fontWeight: 800 }}>⚡ {info.amount_sat.toLocaleString()} sats</Typography>
                        : <TextField label="Amount (sats)" type="number" size="small" value={amount} autoFocus onChange={(e) => setAmount(e.target.value)}
                            helperText="This invoice has no amount: choose how much to pay" />}
                    <Typography variant="body2">From <b>{msg?.callsign || 'unknown'}</b> over the satellite{info.description ? ` · “${info.description}”` : ''}</Typography>
                    {info.destination && <Typography variant="caption" sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>To node {info.destination}</Typography>}
                    {sats > 0 && <Typography variant="body2" color="text.secondary">Routing fee at most {feeLimit(sats).toLocaleString()} sats. Paid from your node.</Typography>}
                    {info.decode_error && <Alert severity="warning" variant="outlined">Your node could not read it: {info.decode_error}</Alert>}
                </Stack>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose} disabled={paying}>Cancel</Button>
                <Button variant="contained" onClick={pay} disabled={paying || !(sats > 0)} startIcon={paying ? <CircularProgress size={16} /> : <BoltRoundedIcon />}>
                    Pay
                </Button>
            </DialogActions>
        </Dialog>
    );
}

function InvoiceList({ messages, settings, socket, dispatch }) {
    const rows = messages.filter((m) => m.payload_type === 2 && m.body_text);
    const [paying, setPaying] = useState(null);
    const connected = !!settings?.lightning?.macaroon_set;
    const sendReceipt = async (m) => {
        const info = m.relay_result || {};
        const pay = info.payment || {};
        const body = `Paid ⚡ ${(pay.amount_sat || info.amount_sat || 0).toLocaleString()} sats${info.description ? ` for "${info.description}"` : ''}. Proof (preimage): ${pay.preimage}`;
        const res = await dispatch(sendMessage({ socket, payload_type: 'text', body }));
        if (res.error) toast.error(res.payload);
        else toast.success('Receipt sent over the satellite');
    };
    return (
        <Paper variant="outlined" sx={{ p: 3, borderRadius: 3 }}>
            <Typography variant="overline" color="text.secondary">Invoices</Typography>
            {!rows.length && <Typography color="text.secondary" sx={{ mt: 1 }}>None yet.</Typography>}
            <Stack spacing={1.5} sx={{ mt: 1 }}>
                {rows.map((m) => {
                    const info = m.relay_result || {};
                    const inv = parseInvoice(m.body_text);
                    const sats = info.amount_sat ?? inv?.sats;
                    const st = INVOICE_STATUS[m.relay_status];
                    const canPay = m.direction === 'rx' && connected && ['unpaid', 'pay_failed', null, undefined].includes(m.relay_status);
                    return (
                        <Box key={m.id}>
                            <Stack direction="row" spacing={1} alignItems="center">
                                <Typography sx={{ fontWeight: 700, minWidth: 120 }}>
                                    ⚡ {sats ? `${sats.toLocaleString()} sats` : 'any amount'}
                                </Typography>
                                <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
                                    {m.direction === 'tx' ? 'Sent' : `From ${m.callsign || 'unknown'}`}{info.description ? ` · “${info.description}”` : ''} · {timeAgo(m.created_at)}
                                </Typography>
                                {st && <Chip size="small" label={st.label} color={st.color} variant={m.relay_status === 'unpaid' ? 'outlined' : 'filled'} />}
                                {canPay && <Button size="small" variant="contained" startIcon={<BoltRoundedIcon />} onClick={() => setPaying(m)}>Pay</Button>}
                                {m.direction === 'rx' && m.relay_status === 'paid' && info.payment?.preimage && (
                                    <Tooltip title="Send the payment proof back over the satellite">
                                        <Button size="small" variant="outlined" onClick={() => sendReceipt(m)}>Send receipt</Button>
                                    </Tooltip>
                                )}
                                <Tooltip title="Copy invoice">
                                    <IconButton size="small" onClick={() => navigator.clipboard?.writeText(m.body_text)}>
                                        <ContentCopyRoundedIcon fontSize="small" />
                                    </IconButton>
                                </Tooltip>
                            </Stack>
                            {m.relay_status === 'pay_failed' && <Typography variant="caption" color="error">{info.payment?.reason}</Typography>}
                            {m.relay_status === 'paid' && info.payment?.fee_sat !== undefined && (
                                <Typography variant="caption" color="text.secondary">Fee {info.payment.fee_sat} sats</Typography>
                            )}
                        </Box>
                    );
                })}
            </Stack>
            <PayDialog key={paying?.id} msg={paying} onClose={() => setPaying(null)} socket={socket} dispatch={dispatch} />
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
                        <LightningCard settings={settings} socket={socket} dispatch={dispatch} />
                        <InvoiceList messages={messages} settings={settings} socket={socket} dispatch={dispatch} />
                    </Stack>
                </Grid>
            </Grid>
        </Box>
    );
}
