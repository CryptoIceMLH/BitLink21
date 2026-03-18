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

import * as React from 'react';
import { Outlet } from "react-router";
import { ReactRouterAppProvider } from "@toolpad/core/react-router";
import { setupTheme } from './theme.js';
import { useSocket } from "./components/common/socket.jsx";
import { AudioProvider } from "./components/dashboard/audio-provider.jsx";
import { ToastContainerWithStyles } from "./utils/toast-container.jsx";
import { getNavigation } from "./config/navigation.jsx";
import { BRANDING } from "./config/branding.jsx";
import { useSocketEventHandlers } from "./hooks/useSocketEventHandlers.jsx";
import { usePassFetching } from "./hooks/usePassFetching.jsx";
import { useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';

export default function App() {
    const { socket } = useSocket();
    const { i18n } = useTranslation();
    const preferences = useSelector((state) => state.preferences.preferences);
    const [navigation, setNavigation] = React.useState(getNavigation());
    const [systemTheme, setSystemTheme] = React.useState('dark');

    // Get theme preference and create theme
    const themePreference = preferences.find(pref => pref.name === 'theme');
    const themeMode = themePreference ? themePreference.value : 'dark';

    // Listen for system theme changes when 'auto' is selected
    React.useEffect(() => {
        if (themeMode !== 'auto') return;

        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
        const handleChange = (e) => {
            setSystemTheme(e.matches ? 'dark' : 'light');
        };

        // Set initial value
        setSystemTheme(mediaQuery.matches ? 'dark' : 'light');

        // Listen for changes
        mediaQuery.addEventListener('change', handleChange);

        return () => {
            mediaQuery.removeEventListener('change', handleChange);
        };
    }, [themeMode]);

    const dashboardTheme = React.useMemo(() => setupTheme(themeMode), [themeMode, systemTheme]);

    // Sync language from Redux to i18n on mount and when it changes
    React.useEffect(() => {
        const languagePref = preferences.find(pref => pref.name === 'language');
        if (languagePref && languagePref.value) {
            const languageCode = languagePref.value.split('_')[0]; // 'en_US' -> 'en', 'el_GR' -> 'el'
            if (i18n.language !== languageCode) {
                i18n.changeLanguage(languageCode);
            }
        }
        // Regenerate navigation after language is set
        setNavigation(getNavigation());
    }, [preferences, i18n]);

    // Update navigation when language changes
    React.useEffect(() => {
        const handleLanguageChange = () => {
            setNavigation(getNavigation());
        };

        i18n.on('languageChanged', handleLanguageChange);

        return () => {
            i18n.off('languageChanged', handleLanguageChange);
        };
    }, [i18n]);

    useSocketEventHandlers(socket);
    usePassFetching(socket);

    return (
        <AudioProvider>
            <ReactRouterAppProvider
                navigation={navigation}
                theme={dashboardTheme}
                branding={BRANDING}
            >
                <Outlet/>
            </ReactRouterAppProvider>
            <ToastContainerWithStyles />
        </AudioProvider>
    );
}
