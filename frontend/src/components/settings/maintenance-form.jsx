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

import Paper from "@mui/material/Paper";
import React from "react";
import { SystemInfoCard } from './maintenance/index.jsx';

// BitLink21: only the system information is kept. The Ground Station
// developer cards (layout storage, Redux inspector, canvas/socket debug,
// sessions, satellite transmitter import, ...) were removed; radio logs are
// in Link > Advanced > Download diagnostics.
const MaintenanceForm = () => (
    <Paper elevation={1} sx={{ p: 2 }}>
        <SystemInfoCard />
    </Paper>
);

export default MaintenanceForm;
