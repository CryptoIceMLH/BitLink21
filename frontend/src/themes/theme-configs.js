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

/**
 * Theme configuration presets
 * Each theme defines a complete set of colors and styles
 */

export const themeConfigs = {
    dark: {
        mode: 'dark',
        primary: { main: '#9a9fa6' },
        secondary: { main: '#d6926b' },
        success: { main: '#59d98b' },
        warning: { main: '#ffcc66' },
        error: { main: '#ff5d6c' },
        info: { main: '#8f969e' },
        background: {
            default: '#111213',
            paper: '#1a1c1e',
            elevated: '#23262a',
            titleBar: '#171a1d',
        },
        border: {
            main: '#383c42',
            light: '#454a51',
            dark: '#2b2f35',
        },
        overlay: {
            light: 'rgba(154, 159, 166, 0.06)',
            medium: 'rgba(154, 159, 166, 0.12)',
            dark: 'rgba(0, 0, 0, 0.6)',
        },
        status: {
            connected: '#59d98b',
            connecting: '#ffcc66',
            disconnected: '#ff5d6c',
            polling: '#ff8f5a',
        },
        action: {
            play: '#59d98b',
            stop: '#ff5d6c',
        },
    },

    'dark-neutral': {
        mode: 'dark',
        primary: { main: '#4f9dff' },
        secondary: { main: '#7bd3b0' },
        success: { main: '#3ecf8e' },
        warning: { main: '#f2b84b' },
        error: { main: '#ff6b6b' },
        info: { main: '#66b8ff' },
        background: {
            default: '#111315',
            paper: '#181b1e',
            elevated: '#20252a',
            titleBar: '#14181c',
        },
        border: {
            main: '#2a2f35',
            light: '#343b43',
            dark: '#1f242a',
        },
        overlay: {
            light: 'rgba(79, 157, 255, 0.08)',
            medium: 'rgba(79, 157, 255, 0.14)',
            dark: 'rgba(0, 0, 0, 0.6)',
        },
        status: {
            connected: '#3ecf8e',
            connecting: '#f2b84b',
            disconnected: '#ff6b6b',
            polling: '#e3a64b',
        },
        action: {
            play: '#3ecf8e',
            stop: '#ff6b6b',
        },
    },

    light: {
        mode: 'light',
        primary: { main: '#1565c0' },
        secondary: { main: '#ad1457' },
        success: { main: '#2e7d32' },
        warning: { main: '#ed6c02' },
        error: { main: '#c62828' },
        info: { main: '#0277bd' },
        background: {
            default: '#edf1f5',
            paper: '#ffffff',
            elevated: '#e2e7ee',
            titleBar: '#dce5ef',
        },
        border: {
            main: '#b5bec8',
            light: '#c2cad4',
            dark: '#98a3af',
        },
        overlay: {
            light: 'rgba(0, 0, 0, 0.10)',
            medium: 'rgba(0, 0, 0, 0.18)',
            dark: 'rgba(0, 0, 0, 0.4)',
        },
        status: {
            connected: '#2e7d32',
            connecting: '#ed6c02',
            disconnected: '#c62828',
            polling: '#ef6c00',
        },
        action: {
            play: '#2e7d32',
            stop: '#c62828',
        },
    },

    'high-contrast': {
        mode: 'dark',
        primary: { main: '#ffffff' },
        secondary: { main: '#ffff00' },
        success: { main: '#00ff00' },
        warning: { main: '#ffff00' },
        error: { main: '#ff0000' },
        info: { main: '#00ffff' },
        background: {
            default: '#000000',
            paper: '#1a1a1a',
            elevated: '#2d2d2d',
            titleBar: '#2d2d2d',
        },
        border: {
            main: '#ffffff',
            light: '#cccccc',
            dark: '#888888',
        },
        overlay: {
            light: 'rgba(255, 255, 255, 0.15)',
            medium: 'rgba(255, 255, 255, 0.25)',
            dark: 'rgba(0, 0, 0, 0.8)',
        },
        status: {
            connected: '#00ff00',
            connecting: '#ffff00',
            disconnected: '#ff0000',
            polling: '#ff8800',
        },
        action: {
            play: '#00ff00',
            stop: '#ff0000',
        },
    },

    night: {
        mode: 'dark',
        primary: { main: '#7f77c3' }, // Soft purple
        secondary: { main: '#03dac6' }, // Teal
        success: { main: '#4caf50' },
        warning: { main: '#fb8c00' },
        error: { main: '#cf6679' },
        info: { main: '#64b5f6' },
        background: {
            default: '#000000', // Pure black for OLED screens
            paper: '#121212', // Very dark gray
            elevated: '#1e1e1e', // Slightly elevated
            titleBar: '#161316',
        },
        border: {
            main: '#2d2d2d',
            light: '#383838',
            dark: '#1a1a1a',
        },
        overlay: {
            light: 'rgba(187, 134, 252, 0.05)', // Purple tint
            medium: 'rgba(187, 134, 252, 0.10)',
            dark: 'rgba(0, 0, 0, 0.8)',
        },
        status: {
            connected: '#4caf50',
            connecting: '#fb8c00',
            disconnected: '#cf6679',
            polling: '#ff9800',
        },
        action: {
            play: '#4caf50',
            stop: '#cf6679',
        },
    },

    'sunset-orange': {
        mode: 'dark',
        primary: { main: '#ff6f00' }, // Deep orange
        secondary: { main: '#ff9e40' }, // Light orange
        success: { main: '#66bb6a' }, // Green
        warning: { main: '#ffa726' }, // Orange
        error: { main: '#ef5350' }, // Red
        info: { main: '#42a5f5' }, // Blue
        background: {
            default: '#1a0f00', // Very dark brown/orange
            paper: '#2d1810', // Dark warm brown
            elevated: '#3d2418', // Medium warm brown
            titleBar: '#3d2820',
        },
        border: {
            main: '#4d3420',
            light: '#5d4430',
            dark: '#3d2410',
        },
        overlay: {
            light: 'rgba(255, 111, 0, 0.08)',
            medium: 'rgba(255, 111, 0, 0.15)',
            dark: 'rgba(0, 0, 0, 0.6)',
        },
        status: {
            connected: '#66bb6a',
            connecting: '#ffa726',
            disconnected: '#ef5350',
            polling: '#ff9800',
        },
        action: {
            play: '#66bb6a',
            stop: '#ef5350',
        },
    },

    'stalker': {
        mode: 'dark',
        primary: { main: '#7fb800' }, // Radioactive green
        secondary: { main: '#b85d00' }, // Rusty orange
        success: { main: '#6fb300' }, // Anomaly green
        warning: { main: '#d4a017' }, // Geiger yellow
        error: { main: '#8b2500' }, // Blood rust
        info: { main: '#4d6b7a' }, // Cold steel blue
        background: {
            default: '#0a0d0a', // The Zone darkness
            paper: '#1a1d1a', // Grimy concrete
            elevated: '#252b25', // Rusted metal
            titleBar: '#2a3a2a',
        },
        border: {
            main: '#3a4a3a', // Weathered steel
            light: '#4a5a4a',
            dark: '#2a3a2a',
        },
        overlay: {
            light: 'rgba(127, 184, 0, 0.08)', // Radioactive glow
            medium: 'rgba(127, 184, 0, 0.15)',
            dark: 'rgba(0, 0, 0, 0.75)', // Heavy shadows
        },
        status: {
            connected: '#6fb300', // Detector green
            connecting: '#d4a017', // Warning yellow
            disconnected: '#8b2500', // Danger red
            polling: '#b85d00', // Artifact orange
        },
        // S.T.A.L.K.E.R. themed custom properties
        radiation: {
            low: '#6fb300',
            medium: '#d4a017',
            high: '#ff4500',
        },
        action: {
            play: '#6fb300',
            stop: '#8b2500',
        },
    },

    'terminal': {
        mode: 'dark',
        primary: { main: '#00ff41' }, // Matrix green
        secondary: { main: '#ff00aa' }, // Surveillance pink
        success: { main: '#00ff41' }, // Access granted
        warning: { main: '#ffaa00' }, // Warning beacon
        error: { main: '#ff0040' }, // System breach
        info: { main: '#00aaff' }, // Data stream
        background: {
            default: '#000000', // Terminal void
            paper: '#0d0d0d', // Command line
            elevated: '#1a1a1a', // Elevated shell
            titleBar: '#0a1a0a',
        },
        border: {
            main: '#00ff41', // Scan line green
            light: '#33ff66',
            dark: '#008822',
        },
        overlay: {
            light: 'rgba(0, 255, 65, 0.06)', // Terminal glow
            medium: 'rgba(0, 255, 65, 0.12)',
            dark: 'rgba(0, 0, 0, 0.85)', // Deep space
        },
        status: {
            connected: '#00ff41', // Link established
            connecting: '#ffaa00', // Handshake
            disconnected: '#ff0040', // Connection lost
            polling: '#00aaff', // Scanning
        },
        // Cyberpunk/hacker themed custom properties
        terminal: {
            cursor: '#00ff41',
            selection: 'rgba(0, 255, 65, 0.3)',
            prompt: '#00aaff',
        },
        surveillance: {
            active: '#ff00aa',
            tracking: '#ffaa00',
            offline: '#444444',
        },
        action: {
            play: '#00ff41',
            stop: '#ff0040',
        },
    },

    'sonar': {
        mode: 'dark',
        primary: { main: '#ffb000' }, // Amber sonar
        secondary: { main: '#ff6600' }, // Deep sea rust
        success: { main: '#88cc00' }, // Contact confirmed
        warning: { main: '#ffaa00' }, // Proximity alert
        error: { main: '#ff3300' }, // Critical depth
        info: { main: '#ffb000' }, // Bearing data
        background: {
            default: '#000000', // Deep ocean void
            paper: '#0a0f12', // Hull interior
            elevated: '#121a20', // Conning tower
            titleBar: '#1a2a18',
        },
        border: {
            main: '#3a4520', // Phosphor grid
            light: '#4d5a2a',
            dark: '#2a3518',
        },
        overlay: {
            light: 'rgba(255, 176, 0, 0.06)', // Amber glow
            medium: 'rgba(255, 176, 0, 0.12)',
            dark: 'rgba(0, 0, 0, 0.85)', // Pressure darkness
        },
        status: {
            connected: '#ffb000', // Sonar lock
            connecting: '#ffaa00', // Pinging
            disconnected: '#664400', // Signal lost
            polling: '#ff8800', // Active sweep
        },
        // Submarine/naval themed custom properties
        sonar: {
            contact: '#ffb000',
            sweep: 'rgba(255, 176, 0, 0.3)',
            grid: '#3a4520',
            bearing: '#ff8800',
        },
        tactical: {
            friendly: '#88cc00',
            unknown: '#ffaa00',
            hostile: '#ff3300',
            neutral: '#7a8080',
        },
        depth: {
            safe: '#88cc00',
            warning: '#ffaa00',
            critical: '#ff3300',
        },
        action: {
            play: '#88cc00',
            stop: '#ff3300',
        },
    },
};

/**
 * Detect system theme preference
 * @returns {string} 'dark' or 'light' based on system preference
 */
export function getSystemThemePreference() {
    if (typeof window !== 'undefined' && window.matchMedia) {
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return 'dark'; // Default fallback
}

/**
 * Get theme configuration by name
 * @param {string} themeName - Name of the theme (dark, light, cyberpunk, etc., or 'auto' for system preference)
 * @returns {object} Theme configuration object
 */
export function getThemeConfig(themeName) {
    // Handle 'auto' theme by detecting system preference
    if (themeName === 'auto') {
        const systemTheme = getSystemThemePreference();
        return themeConfigs[systemTheme];
    }
    return themeConfigs[themeName] || themeConfigs.dark;
}

/**
 * Get list of available themes with metadata
 * @returns {Array<{id: string, name: string}>} Array of theme objects with id and display name
 */
export function getAvailableThemesWithMetadata() {
    return [
        { id: 'auto', name: 'Auto (System)' },
        { id: 'dark', name: 'Dark' },
        { id: 'dark-neutral', name: 'Dark Neutral (Candidate 1)' },
        { id: 'light', name: 'Light' },
        { id: 'high-contrast', name: 'High Contrast' },
        { id: 'night', name: 'Night (OLED)' },
        { id: 'sunset-orange', name: 'Sunset Orange' },
        { id: 'stalker', name: 'S.T.A.L.K.E.R.' },
        { id: 'terminal', name: 'Terminal' },
        { id: 'sonar', name: 'Sonar' },
    ];
}

/**
 * Get list of available theme names
 * @returns {string[]} Array of theme names including 'auto'
 */
export function getAvailableThemes() {
    return getAvailableThemesWithMetadata().map(theme => theme.id);
}
