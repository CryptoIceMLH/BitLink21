import { memo, useRef, useState } from 'react';
import {
    Box, Button, CircularProgress, FormControlLabel, Paper, Stack, Switch, Tab, Tabs, TextField, Tooltip, Typography,
} from '@mui/material';
import SendRoundedIcon from '@mui/icons-material/SendRounded';
import LockRoundedIcon from '@mui/icons-material/LockRounded';
import AttachFileRoundedIcon from '@mui/icons-material/AttachFileRounded';
import { PAYLOAD_TYPES, bodyByteLength, estimateAirtime, parseInvoice } from './link-utils.js';

const MAX_FILE_BYTES = 500 * 1024;
// Above one HSModem transfer (~224 kB) a file goes out as consecutive parts
const PART_BYTES = 200 * 1024;

const PLACEHOLDER = {
    text: 'Write a message…',
    bitcoin_tx: 'Paste a signed raw transaction (hex). A receiving station with relay enabled broadcasts it to the Bitcoin network.',
    lightning_invoice: 'Paste a BOLT11 invoice (lnbc…)',
};

function validate(type, body, file) {
    if (type === 'file') {
        if (!file) return 'empty';
        if (file.size === 0) return 'The file is empty';
        if (file.size > MAX_FILE_BYTES) return `Too large (max ${MAX_FILE_BYTES / 1024} kB)`;
        if (!/^[\x20-\x7e]+$/.test(file.name)) return 'Rename the file to plain ASCII characters (HSModem limitation)';
        return null;
    }
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

const readAsBase64 = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
});

function LinkComposer({ settings, modes, profile, widebandPlan, readyState, sending, onSend, onSendFile }) {
    const [type, setType] = useState('text');
    const [body, setBody] = useState('');
    const [file, setFile] = useState(null);
    const [encrypt, setEncrypt] = useState(null);
    const fileInput = useRef(null);

    const isFile = type === 'file';
    const encryptDefault = settings?.encryption === 'passphrase';
    const encryptOn = encrypt === null ? encryptDefault : encrypt;
    const canEncrypt = !!settings?.passphrase_set;
    const mode = modes.find((m) => m.index === profile?.rx_mode);
    const bytes = isFile ? (file?.size || 0) : bodyByteLength(type, body);
    // Wideband (DVB-S2): everything is sent twice, after a ~2 s lead-in
    const airtime = !bytes ? null
        : widebandPlan?.net_bitrate ? 2 + (bytes + 300) * 8 * 2 / widebandPlan.net_bitrate
            : estimateAirtime(bytes, mode);
    const problem = validate(type, body, file);
    const invoice = type === 'lightning_invoice' ? parseInvoice(body) : null;

    const blocked = readyState.state !== 'ok';
    const disabled = sending || blocked || !!problem;

    const send = async () => {
        let ok;
        if (isFile) {
            ok = await onSendFile({ name: file.name, data_b64: await readAsBase64(file) });
            if (ok) {
                setFile(null);
                if (fileInput.current) fileInput.current.value = '';
            }
            return;
        }
        ok = await onSend({
            payload_type: type,
            body: type === 'bitcoin_tx' ? body.replace(/\s/g, '') : body,
            encrypt: encryptOn && canEncrypt,
        });
        if (ok) setBody('');
    };

    const minutes = airtime && airtime > 90 ? ` (${(airtime / 60).toFixed(1)} min)` : '';

    return (
        <Paper variant="outlined" sx={{ p: { xs: 2, md: 3 }, borderRadius: 3 }}>
            <Tabs value={type} onChange={(_, v) => setType(v)} sx={{ minHeight: 36, mb: 2 }}>
                {PAYLOAD_TYPES.map((p) => <Tab key={p.value} value={p.value} label={p.label} sx={{ minHeight: 36 }} />)}
            </Tabs>

            {isFile ? (
                <Box
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files?.[0]) setFile(e.dataTransfer.files[0]); }}
                    sx={{ border: 1, borderStyle: 'dashed', borderColor: problem && problem !== 'empty' ? 'error.main' : 'divider',
                        borderRadius: 2, p: 3, textAlign: 'center' }}
                >
                    <input ref={fileInput} type="file" hidden onChange={(e) => setFile(e.target.files?.[0] || null)} />
                    <Button variant="outlined" startIcon={<AttachFileRoundedIcon />} onClick={() => fileInput.current?.click()}>
                        {file ? 'Choose another file' : 'Choose a file'}
                    </Button>
                    <Typography variant="body2" sx={{ mt: 1.5 }} color={file ? 'text.primary' : 'text.secondary'}>
                        {file
                            ? `${file.name} · ${(file.size / 1024).toFixed(1)} kB${file.size > PART_BYTES && !widebandPlan ? ` · sent in ${Math.ceil(file.size / PART_BYTES)} parts (BitLink21 stations rejoin them)` : ''}`
                            : `or drop it here · up to ${MAX_FILE_BYTES / 1024} kB, sent as normal HSModem files any station can open`}
                    </Typography>
                    {problem && problem !== 'empty' && <Typography variant="caption" color="error">{problem}</Typography>}
                </Box>
            ) : (
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
            )}

            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }} sx={{ mt: 1 }}>
                {isFile ? (
                    <Typography variant="caption" color="text.secondary">Files are sent in clear</Typography>
                ) : (
                    <Tooltip title={canEncrypt ? 'Encrypt with your shared passphrase (only stations with the same passphrase can read it)' : 'Set a shared passphrase in Advanced to enable encryption'}>
                        <FormControlLabel
                            control={<Switch checked={encryptOn && canEncrypt} disabled={!canEncrypt} onChange={(e) => setEncrypt(e.target.checked)} />}
                            label={<Stack direction="row" spacing={0.5} alignItems="center"><LockRoundedIcon fontSize="small" /><span>Encrypt</span></Stack>}
                        />
                    </Tooltip>
                )}
                <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
                    {airtime ? `${bytes.toLocaleString()} bytes · about ${Math.ceil(airtime)} s on air${minutes}` : ''}
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

export default memo(LinkComposer);
