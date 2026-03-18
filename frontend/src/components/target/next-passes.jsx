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


import React, {useEffect, useRef, useState} from "react";
import {useSocket} from "../common/socket.jsx";
import {
    getClassNamesBasedOnGridEditing,
    getTimeFromISO,
    humanizeFutureDateInMinutes,
    TitleBar
} from "../common/common.jsx";
import {DataGrid, gridClasses, useGridApiRef} from "@mui/x-data-grid";
import { useDispatch, useSelector } from 'react-redux';
import {darken, lighten, styled} from "@mui/material/styles";
import {Box, Typography, IconButton, Tooltip} from '@mui/material';
import ProgressFormatter from "../overview/progressbar-widget.jsx";
import { useTranslation } from 'react-i18next';
import { enUS, elGR } from '@mui/x-data-grid/locales';
import RefreshIcon from '@mui/icons-material/Refresh';
import SettingsIcon from '@mui/icons-material/Settings';
import {
    fetchNextPasses,
    updateSatellitePassesWithElevationCurves,
    setPassesTableColumnVisibility,
    setPassesTablePageSize,
    setOpenPassesTableSettingsDialog
} from './target-slice.jsx';
import {calculateElevationCurvesForPasses} from '../../utils/elevation-curve-calculator.js';
import TargetPassesTableSettingsDialog from './target-passes-table-settings-dialog.jsx';
import { useUserTimeSettings } from '../../hooks/useUserTimeSettings.jsx';


const TimeFormatter = React.memo(function TimeFormatter({ value }) {
    const [, setForceUpdate] = useState(0);
    const { timezone, locale } = useUserTimeSettings();

    // Force component to update regularly
    useEffect(() => {
        const interval = setInterval(() => {
            setForceUpdate(prev => prev + 1);
        }, 1000); // Every minute
        return () => clearInterval(interval);
    }, []);

    return `${getTimeFromISO(value, timezone, locale)} (${humanizeFutureDateInMinutes(value)})`;
});


const DurationFormatter = React.memo(function DurationFormatter({params, value, event_start, event_end}) {
    const [, setForceUpdate] = useState(0);

    // Force component to update regularly
    useEffect(() => {
        const interval = setInterval(() => {
            setForceUpdate(prev => prev + 1);
        }, 1000);
        return () => clearInterval(interval);
    }, []);

    const now = new Date();
    const startDate = new Date(event_start);
    const endDate = new Date(event_end);

    if (params.row.is_geostationary || params.row.is_geosynchronous) {
        return "∞";
    }

    if (startDate > now) {
        // Pass is in the future
        const diffInSeconds = Math.floor((endDate - startDate) / 1000);
        const minutes = Math.floor(diffInSeconds / 60);
        const seconds = diffInSeconds % 60;
        return `${minutes}:${seconds.toString().padStart(2, '0')}`;

    } else if(endDate < now) {
        // Pass ended
        const diffInSeconds = Math.floor((endDate - startDate) / 1000);
        const minutes = Math.floor(diffInSeconds / 60);
        const seconds = diffInSeconds % 60;
        return `${minutes}:${seconds.toString().padStart(2, '0')}`;

    } else if (startDate < now < endDate) {
        // Passing now
        const diffInSeconds = Math.floor((endDate - now) / 1000);
        const minutes = Math.floor(diffInSeconds / 60);
        const seconds = diffInSeconds % 60;
        return `${minutes}:${seconds.toString().padStart(2, '0')}`;

    } else {
        return `no value`;
    }
});


const MemoizedStyledDataGrid = React.memo(function MemoizedStyledDataGrid({
    satellitePasses,
    passesLoading,
    columnVisibility,
    onColumnVisibilityChange,
    pageSize = 15,
    onPageSizeChange
}) {
    const apiRef = useGridApiRef();
    const { t, i18n } = useTranslation('target');
    const currentLanguage = i18n.language;
    const dataGridLocale = currentLanguage === 'el' ? elGR : enUS;
    const [page, setPage] = useState(0);

    useEffect(() => {
        const intervalId = setInterval(() => {
            const rowIds = apiRef.current.getAllRowIds();
            rowIds.forEach((rowId) => {

                // Access the row model
                const rowNode = apiRef.current.getRowNode(rowId);
                if (!rowNode) {
                    return;
                }

                // Update only the row model in the grid's internal state
                apiRef.current.updateRows([{
                    id: rowId,
                    _rowClassName: ''
                }]);
            });
        }, 1000);

        return () => {
            clearInterval(intervalId);
        };
    }, []);


    const getBackgroundColor = (color, theme, coefficient) => ({
        backgroundColor: darken(color, coefficient),
        ...theme.applyStyles('light', {
            backgroundColor: lighten(color, coefficient),
        }),
    });

    const StyledDataGrid = styled(DataGrid)(({ theme }) => ({
        '& .passes-cell-passing': {
            ...getBackgroundColor(theme.palette.success.main, theme, 0.7),
            '&:hover': {
                ...getBackgroundColor(theme.palette.success.main, theme, 0.6),
            },
            '&.Mui-selected': {
                ...getBackgroundColor(theme.palette.success.main, theme, 0.5),
                '&:hover': {
                    ...getBackgroundColor(theme.palette.success.main, theme, 0.4),
                },
            },
        },
        '& .passes-cell-passed': {
            ...getBackgroundColor(theme.palette.info.main, theme, 0.7),
            '&:hover': {
                ...getBackgroundColor(theme.palette.info.main, theme, 0.6),
            },
            '&.Mui-selected': {
                ...getBackgroundColor(theme.palette.info.main, theme, 0.5),
                '&:hover': {
                    ...getBackgroundColor(theme.palette.info.main, theme, 0.4),
                },
            },
            textDecoration: 'line-through',
        },
        '& .passes-cell-warning': {
            color: theme.palette.error.main,
            textDecoration: 'line-through',
        },
        '& .passes-cell-success': {
            color: theme.palette.success.main,
            fontWeight: 'bold',
            textDecoration: 'underline',
        }
    }));

    const columns = [
        {
            field: 'event_start',
            minWidth: 160,
            headerName: t('next_passes.start'),
            flex: 1,
            renderCell: (params) => <TimeFormatter value={params.value} />
        },
        {
            field: 'event_end',
            minWidth: 160,
            headerName: t('next_passes.end'),
            flex: 1,
            renderCell: (params) => <TimeFormatter value={params.value} />
        },
        {
            field: 'duration',
            minWidth: 100,
            headerName: t('next_passes.duration'),
            align: 'center',
            headerAlign: 'center',
            flex: 1,
            renderCell: (params) => (
                <div>
                    <DurationFormatter params={params} value={params.value} event_start={params.row.event_start} event_end={params.row.event_end}/>
                </div>
            ),
        },
        {
            field: 'progress',
            minWidth: 120,
            headerName: t('next_passes.progress'),
            align: 'center',
            headerAlign: 'center',
            flex: 1.5,
            renderCell: (params) => <ProgressFormatter params={params} />
        },
        {
            field: 'distance_at_start',
            minWidth: 100,
            headerName: t('next_passes.distance_aos'),
            align: 'center',
            headerAlign: 'center',
            flex: 1,
            valueFormatter: (value) => {
                return `${parseFloat(value).toFixed(2)} km`
            }
        },
        {
            field: 'distance_at_end',
            minWidth: 100,
            headerName: t('next_passes.distance_los'),
            align: 'center',
            headerAlign: 'center',
            flex: 1,
            valueFormatter: (value) => {
                return `${parseFloat(value).toFixed(2)} km`
            }
        },
        {
            field: 'distance_at_peak',
            minWidth: 100,
            headerName: t('next_passes.distance_peak'),
            align: 'center',
            headerAlign: 'center',
            flex: 1,
            valueFormatter: (value) => {
                return `${parseFloat(value).toFixed(2)} km`
            }
        },
        {
            field: 'peak_altitude',
            minWidth: 100,
            headerName: t('next_passes.max_el'),
            align: 'center',
            headerAlign: 'center',
            flex: 1,
            valueFormatter: (value) => {
                return `${parseFloat(value).toFixed(2)}°`;
            },
            cellClassName: (params) => {
                if (params.value < 10.0) {
                    return "passes-cell-warning";
                } else if (params.value > 45.0) {
                    return "passes-cell-success";
                }
            }
        },
        {
            field: 'is_geostationary',
            minWidth: 70,
            headerName: t('next_passes.geo_stat'),
            align: 'center',
            headerAlign: 'center',
            flex: 1,
            valueFormatter: (value) => {
                return value ? 'Yes' : 'No';
            },
            hide: true,
        },
        {
            field: 'is_geosynchronous',
            minWidth: 70,
            headerName: t('next_passes.geo_sync'),
            align: 'center',
            headerAlign: 'center',
            flex: 1,
            valueFormatter: (value) => {
                return value ? 'Yes' : 'No';
            },
            hide: true,
        },
    ];

    return (
        <StyledDataGrid
            apiRef={apiRef}
            fullWidth={true}
            loading={passesLoading}
            localeText={{
                ...dataGridLocale.components.MuiDataGrid.defaultProps.localeText,
                noRowsLabel: t('next_passes.no_satellite_selected')
            }}
            sx={{
                border: 0,
                marginTop: 0,
                [`& .${gridClasses.cell}:focus, & .${gridClasses.cell}:focus-within`]: {
                    outline: 'none',
                },
                [`& .${gridClasses.columnHeader}:focus, & .${gridClasses.columnHeader}:focus-within`]:
                    {
                        outline: 'none',
                    },
                '& .MuiDataGrid-overlay': {
                    fontSize: '0.875rem',
                    fontStyle: 'italic',
                    color: 'text.secondary',
                },
            }}
            getRowClassName={(param) => {
                if (param.row) {
                    if (new Date(param.row['event_start']) < new Date() && new Date(param.row['event_end']) < new Date()) {
                        return "passes-cell-passed pointer-cursor";
                    } else if (new Date(param.row['event_start']) < new Date() && new Date(param.row['event_end']) > new Date()) {
                        return "passes-cell-passing pointer-cursor";
                    } else {
                        return "pointer-cursor";
                    }
                }
            }}
            density={"compact"}
            rows={satellitePasses}
            pageSizeOptions={[5, 10, 15, 20]}
            columnVisibilityModel={columnVisibility}
            onColumnVisibilityModelChange={onColumnVisibilityChange}
            initialState={{
                sorting: {
                    sortModel: [{ field: 'event_start', sort: 'asc' }],
                },
            }}
            paginationModel={{
                pageSize: pageSize,
                page: page,
            }}
            onPaginationModelChange={(model) => {
                setPage(model.page);
                if (onPageSizeChange && model.pageSize !== pageSize) {
                    onPageSizeChange(model.pageSize);
                }
            }}
            columns={columns}
            disableSelectionOnClick
        />
    );
}, (prevProps, nextProps) => {
    return (
        prevProps.satellitePasses === nextProps.satellitePasses &&
        prevProps.passesLoading === nextProps.passesLoading &&
        prevProps.columnVisibility === nextProps.columnVisibility &&
        prevProps.pageSize === nextProps.pageSize
    );
});


const NextPassesIsland = React.memo(function NextPassesIsland() {
    const {socket} = useSocket();
    const dispatch = useDispatch();
    const { t } = useTranslation('target');
    const [containerHeight, setContainerHeight] = useState(0);
    const containerRef = useRef(null);
    const {
        passesLoading,
        satellitePasses,
        satelliteData,
        nextPassesHours,
        satelliteId,
        gridEditable,
        passesTableColumnVisibility,
        passesTablePageSize,
        openPassesTableSettingsDialog
    } = useSelector(state => state.targetSatTrack);
    const { location } = useSelector(state => state.location);
    const minHeight = 200;
    const maxHeight = 400;
    const hasLoadedFromStorageRef = useRef(false);
    const isLoadingRef = useRef(false);

    // Load column visibility from localStorage on mount
    useEffect(() => {
        // Prevent double loading (React StrictMode or component remounting)
        if (isLoadingRef.current || hasLoadedFromStorageRef.current) {
            return;
        }

        isLoadingRef.current = true;

        const loadColumnVisibility = () => {
            try {
                const stored = localStorage.getItem('target-passes-table-column-visibility');
                if (stored) {
                    const parsedVisibility = JSON.parse(stored);
                    dispatch(setPassesTableColumnVisibility(parsedVisibility));
                }
            } catch (e) {
                console.error('Failed to load target passes table column visibility:', e);
            } finally {
                hasLoadedFromStorageRef.current = true;
                isLoadingRef.current = false;
            }
        };
        loadColumnVisibility();
    }, []);

    // Persist column visibility to localStorage whenever it changes (but not on initial load)
    useEffect(() => {
        if (passesTableColumnVisibility && hasLoadedFromStorageRef.current) {
            try {
                localStorage.setItem('target-passes-table-column-visibility', JSON.stringify(passesTableColumnVisibility));
            } catch (e) {
                console.error('Failed to save target passes table column visibility:', e);
            }
        }
    }, [passesTableColumnVisibility]);

    const handleRefreshPasses = () => {
        if (satelliteId) {
            dispatch(fetchNextPasses({
                socket,
                noradId: satelliteId,
                hours: nextPassesHours,
                forceRecalculate: true
            }));
        }
    };

    // Calculate elevation curves when passes are received or satellite changes
    useEffect(() => {
        // Check if location is valid (not null)
        const isLocationValid = location && location.lat != null && location.lon != null;

        if (satellitePasses && satellitePasses.length > 0 && isLocationValid && satelliteData && satelliteData.details) {
            // Check if elevation curves need to be calculated (if any pass has empty elevation_curve)
            const needsCalculation = satellitePasses.some(pass => !pass.elevation_curve || pass.elevation_curve.length === 0);

            if (needsCalculation) {
                // Create satellite lookup from satelliteData
                const satelliteLookup = {
                    [satelliteData.details.norad_id]: {
                        norad_id: satelliteData.details.norad_id,
                        tle1: satelliteData.details.tle1,
                        tle2: satelliteData.details.tle2
                    }
                };

                // Calculate elevation curves in the background
                setTimeout(() => {
                    const passesWithCurves = calculateElevationCurvesForPasses(
                        satellitePasses,
                        { lat: location.lat, lon: location.lon },
                        satelliteLookup
                    );
                    dispatch(updateSatellitePassesWithElevationCurves(passesWithCurves));
                }, 0);
            }
        }
    }, [satellitePasses, location, satelliteData, satelliteId, dispatch]);

    useEffect(() => {
        const target = containerRef.current;
        const observer = new ResizeObserver((entries) => {
            setContainerHeight(entries[0].contentRect.height);
        });
        if (target) {
            observer.observe(target);
        }
        return () => {
            observer.disconnect();
        };
    }, [containerRef]);

    const handleColumnVisibilityChange = (newModel) => {
        dispatch(setPassesTableColumnVisibility(newModel));
    };

    const handlePageSizeChange = (newPageSize) => {
        dispatch(setPassesTablePageSize(newPageSize));
    };

    const handleOpenSettings = () => {
        dispatch(setOpenPassesTableSettingsDialog(true));
    };

    const handleCloseSettings = () => {
        dispatch(setOpenPassesTableSettingsDialog(false));
    };

    return (
        <>
            <TitleBar
                className={getClassNamesBasedOnGridEditing(gridEditable, ["window-title-bar"])}
                sx={{
                    bgcolor: 'background.titleBar',
                    borderBottom: '1px solid',
                    borderColor: 'border.main',
                    backdropFilter: 'blur(10px)'
                }}
            >
                <Box sx={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%'}}>
                    <Box sx={{display: 'flex', alignItems: 'center'}}>
                        <Typography variant="subtitle2" sx={{fontWeight: 'bold'}}>
                            {t('next_passes.title', { name: satelliteData['details']['name'], hours: nextPassesHours })}
                        </Typography>
                    </Box>
                    <Box sx={{ display: 'flex', gap: 0.5 }}>
                        <Tooltip title={t('passes_table_settings.title')}>
                            <span>
                                <IconButton
                                    size="small"
                                    onClick={handleOpenSettings}
                                    sx={{ padding: '2px' }}
                                >
                                    <SettingsIcon fontSize="small" />
                                </IconButton>
                            </span>
                        </Tooltip>
                        <Tooltip title="Refresh passes (force recalculate)">
                            <span>
                                <IconButton
                                    size="small"
                                    onClick={handleRefreshPasses}
                                    disabled={passesLoading || !satelliteId}
                                    sx={{ padding: '2px' }}
                                >
                                    <RefreshIcon fontSize="small" />
                                </IconButton>
                            </span>
                        </Tooltip>
                    </Box>
                </Box>
            </TitleBar>
            <div style={{ position: 'relative', display: 'block', height: '100%' }} ref={containerRef}>
                <div style={{
                    padding:'0rem 0rem 0rem 0rem',
                    display: 'flex',
                    flexDirection: 'column',
                    height: containerHeight - 25,
                    minHeight,
                }}>
                    <MemoizedStyledDataGrid
                        satellitePasses={satellitePasses}
                        passesLoading={passesLoading}
                        columnVisibility={passesTableColumnVisibility}
                        onColumnVisibilityChange={handleColumnVisibilityChange}
                        pageSize={passesTablePageSize}
                        onPageSizeChange={handlePageSizeChange}
                    />
                </div>
            </div>
            <TargetPassesTableSettingsDialog
                open={openPassesTableSettingsDialog}
                onClose={handleCloseSettings}
            />
        </>
    );
});

export default NextPassesIsland;
