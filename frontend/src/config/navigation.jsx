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

import EngineeringIcon from '@mui/icons-material/Engineering';
import { PreferenceVerticalIcon } from "hugeicons-react";
import InfoIcon from '@mui/icons-material/Info';
import MicrowaveIcon from '@mui/icons-material/Microwave';
import WavesIcon from '@mui/icons-material/Waves';
import CurrencyBitcoinIcon from '@mui/icons-material/CurrencyBitcoin';
import SatelliteAltIcon from '@mui/icons-material/SatelliteAlt';
import SettingsInputAntennaIcon from '@mui/icons-material/SettingsInputAntenna';
import i18n from '../i18n/config.js';

export const getNavigation = () => [
    { kind: 'header', title: 'BitLink21' },
    { segment: '', title: 'Link', icon: <SatelliteAltIcon /> },
    { segment: 'radio', title: 'Radio', icon: <WavesIcon /> },
    { segment: 'bitlink21/align', title: 'Dish alignment', icon: <SettingsInputAntennaIcon /> },
    { segment: 'bitlink21/payments', title: 'Bitcoin & Lightning', icon: <CurrencyBitcoinIcon /> },
    { kind: 'divider' },
    { kind: 'header', title: i18n.t('hardware', { ns: 'navigation' }) },
    { segment: 'hardware/sdrs', title: i18n.t('sdrs', { ns: 'navigation' }), icon: <MicrowaveIcon /> },
    { kind: 'divider' },
    { kind: 'header', title: i18n.t('settings', { ns: 'navigation' }) },
    { segment: 'settings/preferences', title: i18n.t('preferences', { ns: 'navigation' }), icon: <PreferenceVerticalIcon /> },
    { segment: 'settings/maintenance', title: 'System', icon: <EngineeringIcon /> },
    { segment: 'settings/about', title: i18n.t('about', { ns: 'navigation' }), icon: <InfoIcon /> },
];
