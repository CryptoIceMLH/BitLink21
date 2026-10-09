// Helpers for the BitLink21 Link UI

// Friendly speed choices (HSModem speed mode index -> label). All modes stay
// available in Advanced; these cover the useful range for QO-100.
export const SPEEDS = [
    { mode: 0, label: 'Robust', detail: 'BPSK · 1.2 kbit/s', hint: 'Small dish or weak signal' },
    { mode: 2, label: 'Standard', detail: 'QPSK · 3 kbit/s', hint: 'Good default' },
    { mode: 4, label: 'Fast', detail: 'QPSK · 4.4 kbit/s', hint: 'HSModem default' },
    { mode: 9, label: 'Turbo', detail: '8APSK · 7.2 kbit/s', hint: 'Needs a strong signal' },
];

export const PAYLOAD_TYPES = [
    { value: 'text', label: 'Message' },
    { value: 'bitcoin_tx', label: 'Bitcoin TX' },
    { value: 'lightning_invoice', label: 'Lightning' },
    { value: 'file', label: 'File' },
];

// Accepts "10489.6", "10489,600", "10489.600 MHz", "10489600000" -> Hz
export function parseFrequency(input) {
    if (input === null || input === undefined) return null;
    const text = String(input).trim().toLowerCase().replace(',', '.').replace(/\s+/g, '');
    const match = text.match(/^([0-9]*\.?[0-9]+)(ghz|mhz|khz|hz)?$/);
    if (!match) return null;
    const value = parseFloat(match[1]);
    const unit = match[2];
    if (unit === 'ghz') return value * 1e9;
    if (unit === 'mhz') return value * 1e6;
    if (unit === 'khz') return value * 1e3;
    if (unit === 'hz') return value;
    // No unit: big numbers are Hz, small ones MHz
    return value > 1e5 ? value : value * 1e6;
}

export const formatMHz = (hz, digits = 4) => (hz === null || hz === undefined ? '—' : (hz / 1e6).toFixed(digits));

export const formatHz = (hz) => {
    if (hz === null || hz === undefined) return '—';
    const abs = Math.abs(hz);
    const sign = hz > 0 ? '+' : hz < 0 ? '−' : '';
    if (abs >= 1000) return `${sign}${(abs / 1000).toFixed(2)} kHz`;
    return `${sign}${abs.toFixed(0)} Hz`;
};

// Rough airtime for a message: envelope + zip + file header, split into
// 219-byte frames, first/last repeated 3x, plus the 1.5 s lead-in.
export function estimateAirtime(bodyBytes, mode) {
    if (!mode) return null;
    const content = 20 + 12 + bodyBytes + 140; // envelope + callsign + zip overhead (approx)
    const stream = 55 + content;
    const chunks = Math.max(1, Math.ceil(stream / 219));
    const frames = chunks === 1 ? 3 : chunks + 4;
    const symbolsPerFrame = (258 * 8) / mode.bits_per_symbol;
    return 1.5 + (frames * symbolsPerFrame) / mode.symbol_rate;
}

export const bodyByteLength = (type, body) => {
    if (!body) return 0;
    if (type === 'bitcoin_tx') return Math.floor(body.replace(/\s/g, '').length / 2);
    return new TextEncoder().encode(body).length;
};

const MIME = {
    txt: 'text/plain', log: 'text/plain', csv: 'text/csv', json: 'application/json', html: 'text/html', htm: 'text/html',
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp',
    svg: 'image/svg+xml', pdf: 'application/pdf', mp3: 'audio/mpeg', wav: 'audio/wav', mp4: 'video/mp4',
};

export const mimeFor = (name) => MIME[(name || '').split('.').pop().toLowerCase()] || 'application/octet-stream';

// Save or open (new tab) a file the server sent as base64
export function deliverFile(name, dataB64, mode = 'download') {
    const bytes = Uint8Array.from(atob(dataB64), (c) => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: mimeFor(name) }));
    if (mode === 'open') {
        window.open(url, '_blank', 'noopener');
        setTimeout(() => URL.revokeObjectURL(url), 60000);
        return;
    }
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
}

export function timeAgo(epochSeconds) {
    if (!epochSeconds) return '';
    const s = Math.max(0, Date.now() / 1000 - epochSeconds);
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)} min ago`;
    if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
    return new Date(epochSeconds * 1000).toLocaleDateString();
}

// BOLT11 human-readable part -> { network, sats }
export function parseInvoice(text) {
    const t = (text || '').trim().toLowerCase().replace(/^lightning:/, '');
    const sep = t.lastIndexOf('1');
    if (!t.startsWith('ln') || sep < 3) return null;
    const hrp = t.slice(0, sep);
    const nets = [['lnbcrt', 'regtest'], ['lntbs', 'signet'], ['lnbc', 'mainnet'], ['lntb', 'testnet']];
    const net = nets.find(([p]) => hrp.startsWith(p));
    if (!net) return null;
    const m = hrp.slice(net[0].length).match(/^(\d*)([munp]?)$/);
    if (!m) return null;
    const mult = { '': 1e8, m: 1e5, u: 100, n: 0.1, p: 0.0001 }[m[2]];
    return { network: net[1], sats: m[1] ? Math.round(parseInt(m[1], 10) * mult) : null };
}
