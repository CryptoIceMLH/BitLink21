import { useState } from 'react';
import {
    Box, Button, CircularProgress, FormControlLabel, Paper, Stack, Switch, Tab, Tabs, TextField, Tooltip, Typography,
} from '@mui/material';
import SendRoundedIcon from '@mui/icons-material/SendRounded';
import LockRoundedIcon from '@mui/icons-material/LockRounded';
import { PAYLOAD_TYPES, bodyByteLength, estimateAirtime, parseInvoice } from './link-utils.js';

const PLACEHOLDER = {
    text: 'Write a message…',
    bitcoin_tx: 'Paste a signed raw transaction (hex). A receiving station with relay enabled broadcasts it to the Bitcoin network.',
    lightning_invoice: 'Paste a BOLT11 invoice (lnbc…)',
};

function validate(type, body) {
    const b = body.trim();
    if (!b) return 'empty';
    if (type === 'bitcoin_tx') {
        const hex = b.replace(/\s/g, '');
        if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length % 2) return 'Not valid hex';
        if (hex.length < 120) return 'Too short to be a transaction';
    }
    if (type === 'lightning_invoice' && !parseInvoice(b)) return 'Not a BOLT11 invoice';
    return null;
}

export default function LinkComposer({ settings, modes, profile, readyState, sending, onSend }) {
    const [type, setType] = useState('text');
    const [body, setBody] = useState('');
    const [encrypt, setEncrypt] = useState(null);

    const encryptDefault = settings?.encryption === 'passphrase';
    const encryptOn = encrypt === null ? encryptDefault : encrypt;
    const canEncrypt = !!settings?.passphrase_set;
    const mode = modes.find((m) => m.index === profile?.rx_mode);
    const bytes = bodyByteLength(type, body);
    const airtime = bytes ? estimateAirtime(bytes, mode) : null;
    const problem = validate(type, body);
    const invoice = type === 'lightning_invoice' ? parseInvoice(body) : null;

    const blocked = readyState.state !== 'ok';
    const disabled = sending || blocked || !!problem;

    const send = async () => {
        const ok = await onSend({
            payload_type: type,
            body: type === 'bitcoin_tx' ? body.replace(/\s/g, '') : body,
            encrypt: encryptOn && canEncrypt,
        });
        if (ok) setBody('');
    };

    return (
        <Paper variant="outlined" sx={{ p: { xs: 2, md: 3 }, borderRadius: 3 }}>
            <Tabs value={type} onChange={(_, v) => setType(v)} sx={{ minHeight: 36, mb: 2 }}>
                {PAYLOAD_TYPES.map((p) => <Tab key={p.value} value={p.value} label={p.label} sx={{ minHeight: 36 }} />)}
            </Tabs>
            <TextField
                multiline
                minRows={type === 'text' ? 3 : 4}
                maxRows={10}
                fullWidth
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder={PLACEHOLDER[type]}
                error={!!problem && problem !== 'empty'}
                helperText={problem && problem !== 'empty' ? problem
                    : invoice ? `${invoice.sats !== null ? `${invoice.sats.toLocaleString()} sats` : 'Any amount'} · ${invoice.network}` : ' '}
                inputProps={{ style: { fontFamily: type === 'text' ? undefined : 'monospace', fontSize: type === 'text' ? 16 : 13 } }}
                onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !disabled) send(); }}
            />
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }} sx={{ mt: 1 }}>
                <Tooltip title={canEncrypt ? 'Encrypt with your shared passphrase (only stations with the same passphrase can read it)' : 'Set a shared passphrase in Advanced to enable encryption'}>
                    <FormControlLabel
                        control={<Switch checked={encryptOn && canEncrypt} disabled={!canEncrypt} onChange={(e) => setEncrypt(e.target.checked)} />}
                        label={<Stack direction="row" spacing={0.5} alignItems="center"><LockRoundedIcon fontSize="small" /><span>Encrypt</span></Stack>}
                    />
                </Tooltip>
                <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
                    {airtime ? `${bytes} bytes · about ${Math.ceil(airtime)} s on air` : ''}
                </Typography>
                <Box>
                    <Tooltip title={blocked ? readyState.detail : ''}>
                        <span>
                            <Button
                                variant="contained"
                                size="large"
                                disabled={disabled}
                                onClick={send}
                                endIcon={sending ? <CircularProgress size={18} color="inherit" /> : <SendRoundedIcon />}
                                sx={{ px: 5, py: 1.4, borderRadius: 2, fontWeight: 800, fontSize: 16 }}
                            >
                                Send
                            </Button>
                        </span>
                    </Tooltip>
                </Box>
            </Stack>
            {blocked && (
                <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 1, textAlign: 'right' }}>
                    {readyState.detail}
                </Typography>
            )}
        </Paper>
    );
}
