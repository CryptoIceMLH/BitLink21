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



export const satellitePositionSelector = state => state.targetSatTrack.satelliteData.position;
export const satellitePathsSelector = state => state.targetSatTrack.satelliteData.paths;
export const satelliteCoverageSelector = state => state.targetSatTrack.satelliteData.coverage;
export const satelliteTrackingStateSelector = state => state.targetSatTrack.trackingState;
export const satelliteDetailsSelector = state => state.targetSatTrack.satelliteData.details;
export const satelliteTransmittersSelector = state => state.targetSatTrack.satelliteData.transmitters;