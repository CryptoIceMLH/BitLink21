import { describe, expect, it } from 'vitest';
import { estimateAirtime, parseFrequency, parseInvoice } from '../link-utils.js';
import { linkSteps } from '../link-status.jsx';

describe('parseFrequency', () => {
    it('accepts MHz with dot or comma, units, and raw Hz', () => {
        expect(parseFrequency('10489.6')).toBe(10489.6e6);
        expect(parseFrequency('10489,600')).toBe(10489.6e6);
        expect(parseFrequency('10489.600 MHz')).toBe(10489.6e6);
        expect(parseFrequency('10.4896 GHz')).toBeCloseTo(10489.6e6, 0);
        expect(parseFrequency('10489600000')).toBe(10489600000);
    });
    it('rejects garbage', () => {
        expect(parseFrequency('abc')).toBeNull();
        expect(parseFrequency('')).toBeNull();
    });
});

describe('parseInvoice', () => {
    it('reads network and amount from the BOLT11 prefix', () => {
        expect(parseInvoice('lnbc2500u1pvjluezpp5qqq')).toEqual({ network: 'mainnet', sats: 250000 });
        expect(parseInvoice('lntb20m1pvjluez')).toEqual({ network: 'testnet', sats: 2000000 });
        expect(parseInvoice('lnbc1pvjluezpp5')).toEqual({ network: 'mainnet', sats: null });
        expect(parseInvoice('hello')).toBeNull();
    });
});

describe('estimateAirtime', () => {
    it('scales with message size and speed', () => {
        const fast = { bits_per_symbol: 3, symbol_rate: 2400 };
        const slow = { bits_per_symbol: 1, symbol_rate: 1200 };
        expect(estimateAirtime(20, fast)).toBeLessThan(estimateAirtime(20, slow));
        expect(estimateAirtime(2000, fast)).toBeGreaterThan(estimateAirtime(20, fast));
    });
});

describe('linkSteps', () => {
    const settings = { tx_enabled: true, callsign: 'DL1ABC', profile: { beacon_lock: true }, pluto_host: '192.168.1.200' };
    const plan = { tx_allowed: true };

    it('walks radio -> lock -> channel -> ready', () => {
        const status = {
            correction_hz: -16200,
            beacon: { locked: true, rate_hz_s: 1.2 },
            modem: { state: 'searching', signal_detected: false },
        };
        const s = linkSteps({ stationRunning: true, status, settings, plan, busy: false, stationError: null });
        expect([s.radio.state, s.lock.state, s.channel.state, s.ready.state]).toEqual(['ok', 'ok', 'ok', 'ok']);
    });

    it('explains why sending is blocked', () => {
        const status = { beacon: { locked: true }, modem: {} };
        const blocked = linkSteps({
            stationRunning: true, status, settings, plan: { tx_allowed: false, tx_block_reason: 'Channel overlaps a beacon segment' },
        });
        expect(blocked.ready).toEqual({ state: 'error', detail: 'Channel overlaps a beacon segment' });
        const rxOnly = linkSteps({ stationRunning: true, status, settings: { ...settings, tx_enabled: false }, plan });
        expect(rxOnly.ready.state).toBe('wait');
    });

    it('shows the beacon search while not locked', () => {
        const s = linkSteps({ stationRunning: true, status: { beacon: { locked: false }, modem: {} }, settings, plan });
        expect(s.lock.state).toBe('busy');
        expect(s.channel.state).toBe('wait');
    });
});
