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

import React, { useState } from 'react';
import { Box } from '@mui/material';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { tabsClasses } from '@mui/material/Tabs';
import { AntTab, AntTabs } from "../common/common.jsx";
import AboutPage from "./about.jsx";
import PreferencesForm from "./preferences-form.jsx";
import MaintenanceForm from "./maintenance-form.jsx";
import SDRsPage from "../hardware/sdr-table.jsx";

// BitLink21 settings: hardware (the PlutoSDR) and app settings. The Ground
// Station tabs (location, rigs, rotators, cameras, satellites, TLE sources)
// were removed: BitLink21 needs no station location or tracking hardware.

export function SettingsTabPreferences() {
    return (<SettingsTabs initialMainTab="settings" initialTab="preferences"/>);
}

export function SettingsTabMaintenance() {
    return (<SettingsTabs initialMainTab="settings" initialTab="maintenance"/>);
}

export function SettingsTabAbout() {
    return (<SettingsTabs initialMainTab="settings" initialTab="about"/>);
}

export function SettingsTabSDR() {
    return (<SettingsTabs initialMainTab="hardware" initialTab="sdrs"/>);
}

const tabsTree = {
    hardware: ["sdrs"],
    settings: ["preferences", "maintenance", "about"],
};

const scrollSx = { [`& .${tabsClasses.scrollButtons}`]: { '&.Mui-disabled': { opacity: 0.3 } } };

export const SettingsTabs = React.memo(function SettingsTabs({ initialMainTab, initialTab }) {
    const { t } = useTranslation('settings');
    const [activeMainTab, setActiveMainTab] = useState(initialMainTab);
    const [activeTab, setActiveTab] = useState(initialTab);

    const handleMainTabChange = (event, newValue) => {
        setActiveMainTab(newValue);
        setActiveTab(tabsTree[newValue][0]);
    };

    const handleTabChange = (event, newValue) => {
        setActiveTab(newValue);
        setActiveMainTab(Object.keys(tabsTree).find((k) => tabsTree[k].includes(newValue)));
    };

    const tabsList = activeMainTab === "hardware"
        ? [<AntTab key="sdrs" value="sdrs" label={t('tabs.sdrs')} to="/hardware/sdrs" component={Link}/>]
        : [
            <AntTab key="preferences" value="preferences" label={t('tabs.preferences')} to="/settings/preferences" component={Link}/>,
            <AntTab key="maintenance" value="maintenance" label="System" to="/settings/maintenance" component={Link}/>,
            <AntTab key="about" value="about" label={t('tabs.about')} to="/settings/about" component={Link}/>,
        ];

    const content = {
        preferences: <PreferencesForm/>,
        maintenance: <MaintenanceForm/>,
        about: <AboutPage/>,
        sdrs: <SDRsPage/>,
    }[activeTab] || null;

    return (
        <Box sx={{ flexGrow: 1, bgcolor: 'background.paper' }}>
            <AntTabs sx={scrollSx} value={activeMainTab} onChange={handleMainTabChange}
                aria-label={t('tabs.main_settings_tabs')} scrollButtons variant="fullWidth" allowScrollButtonsMobile>
                <AntTab value="hardware" label={t('tabs.hardware')} to="/hardware/sdrs" component={Link}/>
                <AntTab value="settings" label={t('tabs.settings')} to="/settings/preferences" component={Link}/>
            </AntTabs>
            <AntTabs sx={scrollSx} value={activeTab} onChange={handleTabChange}
                aria-label={t('tabs.configuration_tabs')} scrollButtons variant="scrollable" allowScrollButtonsMobile>
                {tabsList}
            </AntTabs>
            {content}
        </Box>
    );
});
