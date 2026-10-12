// Shared drawing and audio helpers for the Radio and Dish alignment pages.
// Everything here works on refs and canvases directly (no React state), so a
// 15 frames/s stream never re-renders the page.

// Decode a bitlink21:spectrum frame into dB values in ascending RF order.
export function decodeFrame(frame) {
    const raw = Uint8Array.from(atob(frame.bins_b64), (c) => c.charCodeAt(0));
    const n = raw.length;
    const db = new Float32Array(n);
    const floor = frame.db_floor;
    for (let i = 0; i < n; i++) db[i] = floor + raw[i] / 2;
    if (frame.rf_sign < 0) db.reverse();
    const half = frame.span_hz / 2;
    return { db, rfLo: frame.rf_centre_hz - half, rfHi: frame.rf_centre_hz + half };
}

export const formatRf = (hz) => {
    if (hz === null || hz === undefined) return '—';
    const khz = Math.round(hz / 10) / 100; // 10 Hz resolution
    const mhz = Math.floor(khz / 1000);
    const rest = (khz - mhz * 1000).toFixed(2).padStart(6, '0');
    return `${mhz}.${rest}`;
};

// Level range that follows the signal: floor from a low percentile,
// top from the strongest bins, eased so the picture does not pump.
export function updateLevels(levels, db) {
    const sorted = Float32Array.from(db).sort();
    const lo = sorted[Math.floor(sorted.length * 0.2)] - 3;
    const hi = Math.max(sorted[sorted.length - 1] + 3, lo + 25);
    if (!levels.init) return { lo, hi, init: true };
    return { lo: levels.lo + 0.08 * (lo - levels.lo), hi: levels.hi + 0.08 * (hi - levels.hi), init: true };
}

// 256-colour waterfall palette (dark blue -> cyan -> yellow -> white)
export const PALETTE = (() => {
    const stops = [[0, 0, 0, 20], [0.25, 10, 30, 120], [0.5, 20, 160, 200], [0.75, 240, 220, 40], [1, 255, 255, 255]];
    const out = new Uint8ClampedArray(256 * 4);
    for (let i = 0; i < 256; i++) {
        const t = i / 255;
        let k = 0;
        while (k < stops.length - 2 && t > stops[k + 1][0]) k++;
        const [t0, r0, g0, b0] = stops[k];
        const [t1, r1, g1, b1] = stops[k + 1];
        const u = (t - t0) / (t1 - t0);
        out.set([r0 + u * (r1 - r0), g0 + u * (g1 - g0), b0 + u * (b1 - b0), 255], i * 4);
    }
    return out;
})();

export function fitCanvas(c) {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(c.clientWidth * dpr));
    const h = Math.max(1, Math.round(c.clientHeight * dpr));
    if (c.width !== w || c.height !== h) {
        c.width = w;
        c.height = h;
    }
    return dpr;
}

// Spectrum trace with optional overlays. marks: [{rf, colour, label}], bands: [{lo, hi, colour}]
export function drawSpectrum(canvas, spec, levels, pal, { marks = [], bands = [], vfo = null, peak = null } = {}) {
    const dpr = fitCanvas(canvas);
    const g = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    g.clearRect(0, 0, W, H);
    if (!spec) return;
    const { db, rfLo, rfHi } = spec;
    const x = (rf) => ((rf - rfLo) / (rfHi - rfLo)) * W;
    const y = (v) => H - ((v - levels.lo) / (levels.hi - levels.lo)) * H;
    for (const b of bands) {
        g.fillStyle = b.colour;
        g.fillRect(x(b.lo), 0, x(b.hi) - x(b.lo), H);
    }
    if (vfo) {
        g.fillStyle = pal.warning.main + '33';
        g.fillRect(x(vfo.lo), 0, Math.max(dpr, x(vfo.hi) - x(vfo.lo)), H);
    }
    // grid every 10 dB
    g.strokeStyle = pal.divider;
    g.fillStyle = pal.text.secondary;
    g.lineWidth = dpr;
    g.font = `${10 * dpr}px sans-serif`;
    for (let v = Math.ceil(levels.lo / 10) * 10; v < levels.hi; v += 10) {
        g.beginPath(); g.moveTo(0, y(v)); g.lineTo(W, y(v)); g.stroke();
        g.fillText(`${v}`, 3 * dpr, y(v) - 2 * dpr);
    }
    const n = db.length;
    const trace = (arr, colour, width) => {
        g.strokeStyle = colour;
        g.lineWidth = width * dpr;
        g.beginPath();
        for (let i = 0; i < n; i++) {
            const px = ((i + 0.5) / n) * W;
            if (i) g.lineTo(px, y(arr[i])); else g.moveTo(px, y(arr[i]));
        }
        g.stroke();
    };
    if (peak) trace(peak, pal.text.disabled, 1);
    trace(db, pal.primary.main, 1.5);
    for (const m of marks) {
        if (m.rf < rfLo || m.rf > rfHi) continue;
        g.strokeStyle = m.colour;
        g.lineWidth = 1.5 * dpr;
        g.setLineDash([4 * dpr, 3 * dpr]);
        g.beginPath(); g.moveTo(x(m.rf), 0); g.lineTo(x(m.rf), H); g.stroke();
        g.setLineDash([]);
        g.fillStyle = m.colour;
        g.fillText(m.label, x(m.rf) + 3 * dpr, 12 * dpr);
    }
}

// Scrolling waterfall kept in an offscreen canvas one pixel per bin.
export class Waterfall {
    constructor(rows = 300) {
        this.rows = rows;
        this.buf = null;
        this.key = '';
    }

    push(spec, levels) {
        const n = spec.db.length;
        const key = `${n}:${Math.round(spec.rfLo)}:${Math.round(spec.rfHi)}`;
        if (!this.buf || key !== this.key) { // new span or zoom: start over
            this.buf = document.createElement('canvas');
            this.buf.width = n;
            this.buf.height = this.rows;
            this.key = key;
        }
        const g = this.buf.getContext('2d');
        g.drawImage(this.buf, 0, 0, n, this.rows - 1, 0, 1, n, this.rows - 1);
        const row = g.createImageData(n, 1);
        const span = levels.hi - levels.lo;
        for (let i = 0; i < n; i++) {
            const c = Math.max(0, Math.min(255, Math.round(((spec.db[i] - levels.lo) / span) * 255)));
            row.data.set(PALETTE.subarray(c * 4, c * 4 + 4), i * 4);
        }
        g.putImageData(row, 0, 0);
    }

    draw(canvas) {
        fitCanvas(canvas);
        const g = canvas.getContext('2d');
        g.imageSmoothingEnabled = false;
        g.clearRect(0, 0, canvas.width, canvas.height);
        if (this.buf) g.drawImage(this.buf, 0, 0, canvas.width, canvas.height);
    }
}

// Plays 8 kHz PCM chunks from bitlink21:audio with a small jitter buffer.
export class AudioPlayer {
    constructor() {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        this.ctx = new Ctx();
        this.gain = this.ctx.createGain();
        this.gain.connect(this.ctx.destination);
        this.next = 0;
    }

    setVolume(v) {
        this.gain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
    }

    push(msg) {
        const raw = atob(msg.pcm_b64);
        const n = raw.length >> 1;
        if (!n) return;
        const buf = this.ctx.createBuffer(1, n, msg.rate);
        const ch = buf.getChannelData(0);
        for (let i = 0; i < n; i++) {
            let v = raw.charCodeAt(2 * i) | (raw.charCodeAt(2 * i + 1) << 8);
            if (v & 0x8000) v -= 0x10000;
            ch[i] = v / 32768;
        }
        const src = this.ctx.createBufferSource();
        src.buffer = buf;
        src.connect(this.gain);
        const now = this.ctx.currentTime;
        if (this.next < now + 0.05 || this.next > now + 0.6) this.next = now + 0.15; // (re)start or drift
        src.start(this.next);
        this.next += buf.duration;
    }

    close() {
        this.ctx.close();
    }
}
