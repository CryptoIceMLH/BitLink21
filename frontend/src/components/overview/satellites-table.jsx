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

import React, { useRef, useState, useEffect, useCallback } from "react";
import { useStore } from 'react-redux';
import { useDispatch, useSelector } from "react-redux";
import { DataGrid, gridClasses } from "@mui/x-data-grid";
import { useGridApiRef } from '@mui/x-data-grid';
import { darken, lighten, styled } from '@mui/material/styles';
import {Typography, Chip, Tooltip, Box, FormControl, InputLabel, Select, MenuItem, ListSubheader} from "@mui/material";
import {
    getClassNamesBasedOnGridEditing,
    humanizeDate,
    renderCountryFlagsCSV,
    TitleBar
} from "../common/common.jsx";
import ElevationDisplay from "../common/elevation-display.jsx";
import { useUserTimeSettings } from '../../hooks/useUserTimeSettings.jsx';
import { formatDate as formatDateHelper } from '../../utils/date-time.js';
import {
    setSelectedSatelliteId,
    setSatellitesTableColumnVisibility,
    setSatellitesTablePageSize,
    setSatellitesTableSortModel,
    setSelectedSatGroupId,
    fetchSatellitesByGroupId,
    fetchSatelliteGroups,
    setOpenSatellitesTableSettingsDialog,
} from './overview-slice.jsx';
import { useTranslation } from 'react-i18next';
import { enUS, elGR } from '@mui/x-data-grid/locales';
import GpsFixedIcon from '@mui/icons-material/GpsFixed';
import SettingsIcon from '@mui/icons-material/Settings';
import {useSocket} from "../common/socket.jsx";
import { toast } from '../../utils/toast-with-timestamp.jsx';
import SatellitesTableSettingsDialog from './satellites-table-settings-dialog.jsx';
import IconButton from '@mui/material/IconButton';

const SATELLITE_NUMBER_LIMIT = 200;

const MemoizedStyledDataGrid = React.memo(({
                                               apiRef,
                                               satellites,
                                               onRowClick,
                                               selectedSatelliteId,
                                               loadingSatellites,
                                               columnVisibility,
                                               onColumnVisibilityChange,
                                               selectedSatellitePositionsRef,
                                               pageSize = 50,
                                               onPageSizeChange,
                                               sortModel,
                                               onSortModelChange,
                                            }) => {
    const { t, i18n } = useTranslation('overview');
    const currentLanguage = i18n.language;
    const dataGridLocale = currentLanguage === 'el' ? elGR : enUS;
    const [page, setPage] = useState(0);
    const { timezone, locale } = useUserTimeSettings();

    const getBackgroundColor = (color, theme, coefficient) => ({
        backgroundColor: darken(color, coefficient),
        ...theme.applyStyles('light', {
            backgroundColor: lighten(color, coefficient),
        }),
    });

    const StyledDataGrid = styled(DataGrid)(({ theme }) => ({
        '& .satellite-cell-alive': {
            ...getBackgroundColor(theme.palette.success.main, theme, 0.8),
            '&:hover': {
                ...getBackgroundColor(theme.palette.success.main, theme, 0.7),
            },
            '&.Mui-selected': {
                ...getBackgroundColor(theme.palette.success.main, theme, 0.6),
                '&:hover': {
                    ...getBackgroundColor(theme.palette.success.main, theme, 0.5),
                },
            },
        },
        '& .satellite-cell-dead': {
            ...getBackgroundColor(theme.palette.error.main, theme, 0.8),
            '&:hover': {
                ...getBackgroundColor(theme.palette.error.main, theme, 0.7),
            },
            '&.Mui-selected': {
                ...getBackgroundColor(theme.palette.error.main, theme, 0.6),
                '&:hover': {
                    ...getBackgroundColor(theme.palette.error.main, theme, 0.5),
                },
            },
            textDecoration: 'line-through',
        },
        '& .satellite-cell-reentered': {
            ...getBackgroundColor(theme.palette.warning.main, theme, 0.8),
            '&:hover': {
                ...getBackgroundColor(theme.palette.warning.main, theme, 0.7),
            },
            '&.Mui-selected': {
                ...getBackgroundColor(theme.palette.warning.main, theme, 0.6),
                '&:hover': {
                    ...getBackgroundColor(theme.palette.warning.main, theme, 0.5),
                },
            },
            textDecoration: 'line-through',
        },
        '& .satellite-cell-unknown': {
            ...getBackgroundColor(theme.palette.grey[500], theme, 0.8),
            '&:hover': {
                ...getBackgroundColor(theme.palette.grey[500], theme, 0.7),
            },
            '&.Mui-selected': {
                ...getBackgroundColor(theme.palette.grey[500], theme, 0.6),
                '&:hover': {
                    ...getBackgroundColor(theme.palette.grey[500], theme, 0.5),
                },
            },
        },
        '& .satellite-cell-selected': {
            ...getBackgroundColor(theme.palette.secondary.dark, theme, 0.7),
            fontWeight: 'bold',
            '&:hover': {
                ...getBackgroundColor(theme.palette.secondary.main, theme, 0.6),
            },
            '&.Mui-selected': {
                ...getBackgroundColor(theme.palette.secondary.main, theme, 0.5),
                '&:hover': {
                    ...getBackgroundColor(theme.palette.secondary.main, theme, 0.4),
                },
            },
        }
    }));

    const formatDate = (dateString) => {
        if (!dateString) return t('satellites_table.na');
        try {
            return formatDateHelper(dateString, {
                timezone,
                locale,
                options: { year: 'numeric', month: 'short', day: 'numeric' },
            });
        } catch (e) {
            return t('satellites_table.invalid_date');
        }
    };

    const columns = [
        {
            field: 'name',
            minWidth: 100,
            headerName: t('satellites_table.satellite_name'),
            flex: 2,
            renderCell: (params) => {
                if (!params || !params.row) return <Typography>-</Typography>;
                const isTracked = selectedSatelliteId === params.row.norad_id;
                const tooltipText = [
                    params.row.alternative_name,
                    params.row.name_other
                ].filter(Boolean).join(' / ') || t('satellites_table.no_alternative_names');
                return (
                    <Tooltip title={tooltipText}>
                        <span>
                            {isTracked && (
                                <GpsFixedIcon sx={{ mr: 0.5, fontSize: '1.3rem', color: 'info.main', verticalAlign: 'middle' }} />
                            )}
                            {params.value || '-'}
                        </span>
                    </Tooltip>
                );
            }
        },
        {
            field: 'alternative_name',
            minWidth: 100,
            headerName: t('satellites_table.alternative_name'),
            flex: 2,
            renderCell: (params) => {
                if (!params || !params.row) return <Typography>-</Typography>;
                return (
                    <Tooltip title={params.row.name_other || ''}>
                        <span>{params.value || '-'}</span>
                    </Tooltip>
                );
            }
        },
        {
            field: 'norad_id',
            minWidth: 70,
            headerName: t('satellites_table.norad'),
            align: 'center',
            headerAlign: 'center',
            flex: 1
        },
        {
            field: 'elevation',
            minWidth: 70,
            headerName: t('satellites_table.elevation'),
            align: 'center',
            headerAlign: 'center',
            flex: 1,
            renderCell: (params) => {
                const noradId = params.row.norad_id;
                const selectedSatellitePositions = selectedSatellitePositionsRef.current();
                const position = selectedSatellitePositions?.[noradId];

                return (
                    <ElevationDisplay
                        elevation={position?.el}
                        trend={position?.trend}
                        timeToMaxEl={position?.timeToMaxEl}
                        elRate={position?.elRate}
                    />
                );
            }
        },
        {
            field: 'status',
            minWidth: 90,
            headerName: t('satellites_table.status'),
            align: 'center',
            headerAlign: 'center',
            flex: 1,
            renderCell: (params) => {
                if (!params || !params.value) {
                    return <Chip
                        label={t('satellites_table.status_unknown')}
                        color="default"
                        size="small"
                        sx={{
                            fontWeight: 'bold',
                            height: '20px',
                            fontSize: '0.7rem',
                            '& .MuiChip-label': {
                                padding: '0 8px 0px 8px'
                            }
                        }}
                    />;
                }

                const status = params.value;
                let color = 'default';
                let label = t('satellites_table.status_unknown');

                switch (status) {
                    case 'alive':
                        color = 'success';
                        label = t('satellites_table.status_active');
                        break;
                    case 'dead':
                        color = 'error';
                        label = t('satellites_table.status_inactive');
                        break;
                    case 're-entered':
                        color = 'warning';
                        label = t('satellites_table.status_reentered');
                        break;
                    default:
                        color = 'default';
                        label = t('satellites_table.status_unknown');
                }

                return (
                    <Chip
                        label={label}
                        color={color}
                        size="small"
                        sx={{
                            fontWeight: 'bold',
                            height: '20px',
                            fontSize: '0.7rem',
                            '& .MuiChip-label': {
                                padding: '0px 8px 0px 8px'
                            }
                        }}
                    />

                );
            }
        },
        {
            field: 'transmitters',
            minWidth: 90,
            headerName: t('satellites_table.transmitters'),
            align: 'center',
            headerAlign: 'center',
            flex: 1.2,
            renderCell: (params) => {
                if (!params?.row?.transmitters) return <span>0</span>;

                const transmitters = params.row.transmitters;
                const aliveCount = transmitters.filter(t => t.alive).length;
                const deadCount = transmitters.length - aliveCount;

                return (
                    <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <Box sx={{
                        width: '8px',
                        height: '8px',
                        bgcolor: 'success.main',
                        borderRadius: '50%',
                        display: 'inline-block'
                    }}></Box>
                            <span style={{ fontSize: '1rem' }}>{aliveCount}</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <Box sx={{
                        width: '8px',
                        height: '8px',
                        bgcolor: 'error.main',
                        borderRadius: '50%',
                        display: 'inline-block'
                    }}></Box>
                            <span style={{ fontSize: '1rem' }}>{deadCount}</span>
                        </div>
                    </div>
                );
            }
        },
        {
            field: 'countries',
            minWidth: 120,
            headerName: t('satellites_table.countries'),
            align: 'center',
            headerAlign: 'center',
            flex: 1.5,
            renderCell: (params) => {
                if (!params?.value) {
                    return <span>-</span>;
                }
                return renderCountryFlagsCSV(params.value);
            }
        },
        {
            field: 'decayed',
            minWidth: 140,
            headerName: t('satellites_table.decayed'),
            align: 'center',
            headerAlign: 'center',
            flex: 1.5,
            renderCell: (params) => {
                if (!params || !params.value) return <span>-</span>;
                return <span>{formatDate(params.value)}</span>;
            }
        },
        {
            field: 'updated',
            minWidth: 140,
            headerName: t('satellites_table.updated'),
            align: 'center',
            headerAlign: 'center',
            flex: 1.5,
            renderCell: (params) => {
                if (!params || !params.value) return <span>{t('satellites_table.na')}</span>;
                try {
                    const date = new Date(params.value);
                    return <span>{humanizeDate(date)}</span>;
                } catch (e) {
                    return <span>{t('satellites_table.invalid_date')}</span>;
                }
            }
        },
        {
            field: 'launched',
            minWidth: 140,
            headerName: t('satellites_table.launched'),
            align: 'center',
            headerAlign: 'center',
            flex: 1.5,
            renderCell: (params) => {
                if (!params || !params.value) return <span>{t('satellites_table.na')}</span>;
                return <span>{formatDate(params.value)}</span>;
            }
        }
    ];

    // Memoize the row class name function to prevent unnecessary rerenders
    const getSatelliteRowStyles = useCallback((params) => {
        if (!params.row) return "pointer-cursor";

        if (selectedSatelliteId === params.row.norad_id) {
            return "satellite-cell-selected pointer-cursor";
        }

        // Color rows based on elevation: green only if positive
        const selectedSatellitePositions = selectedSatellitePositionsRef.current();
        const elevation = selectedSatellitePositions?.[params.row.norad_id]?.el;
        if (elevation !== null && elevation !== undefined && elevation > 0) {
            return "satellite-cell-alive pointer-cursor";
        }

        return "pointer-cursor";
    }, [selectedSatelliteId, selectedSatellitePositionsRef]);

    return (
        <StyledDataGrid
            loading={loadingSatellites}
            apiRef={apiRef}
            pageSizeOptions={[5, 10, 15, 20, 50]}
            fullWidth={true}
            getRowClassName={getSatelliteRowStyles}
            onRowClick={onRowClick}
            getRowId={(params) => params.norad_id}
            localeText={dataGridLocale.components.MuiDataGrid.defaultProps.localeText}
            columnVisibilityModel={columnVisibility}
            onColumnVisibilityModelChange={onColumnVisibilityChange}
            sx={{
                border: 0,
                marginTop: 0,
                [`& .${gridClasses.cell}:focus, & .${gridClasses.cell}:focus-within`]: {
                    outline: 'none',
                },
                [`& .${gridClasses.columnHeader}:focus, & .${gridClasses.columnHeader}:focus-within`]: {
                    outline: 'none',
                },
            }}
            density={"compact"}
            rows={satellites || []}
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
            sortModel={sortModel}
            onSortModelChange={onSortModelChange}
            columns={columns}
        />
    );
});

const SatelliteDetailsTable = React.memo(function SatelliteDetailsTable() {
    const dispatch = useDispatch();
    const { t } = useTranslation('overview');
    const { socket } = useSocket();
    const containerRef = useRef(null);
    const [containerHeight, setContainerHeight] = useState(0);
    const apiRef = useGridApiRef();
    const store = useStore();

    // Use ref-based selector to prevent re-renders from position updates
    const selectedSatellitePositionsRef = useRef(() => {
        const state = store.getState();
        return state.overviewSatTrack.selectedSatellitePositions;
    });

    // Use memoized selectors to prevent unnecessary rerenders
    const selectedSatellites = useSelector(state => state.overviewSatTrack.selectedSatellites);
    const gridEditable = useSelector(state => state.overviewSatTrack.gridEditable);
    const loadingSatellites = useSelector(state => state.overviewSatTrack.loadingSatellites);
    const selectedSatelliteId = useSelector(state => state.targetSatTrack?.satelliteData?.details?.norad_id);
    const selectedSatGroupId = useSelector(state => state.overviewSatTrack.selectedSatGroupId);
    const columnVisibility = useSelector(state => state.overviewSatTrack.satellitesTableColumnVisibility);
    const satellitesTablePageSize = useSelector(state => state.overviewSatTrack.satellitesTablePageSize);
    const satellitesTableSortModel = useSelector(state => state.overviewSatTrack.satellitesTableSortModel);
    const satGroups = useSelector(state => state.overviewSatTrack.satGroups);
    const passesLoading = useSelector(state => state.overviewSatTrack.passesLoading);
    const openSatellitesTableSettingsDialog = useSelector(state => state.overviewSatTrack.openSatellitesTableSettingsDialog);

    const minHeight = 200;
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
                const stored = localStorage.getItem('satellites-table-column-visibility');
                if (stored) {
                    const parsedVisibility = JSON.parse(stored);
                    dispatch(setSatellitesTableColumnVisibility(parsedVisibility));
                }
            } catch (e) {
                console.error('Failed to load satellites table column visibility:', e);
            } finally {
                hasLoadedFromStorageRef.current = true;
                isLoadingRef.current = false;
            }
        };
        loadColumnVisibility();
    }, []); // Empty deps - only run once on mount

    // Persist column visibility to localStorage whenever it changes (but not on initial load)
    useEffect(() => {
        if (columnVisibility && hasLoadedFromStorageRef.current) {
            try {
                localStorage.setItem('satellites-table-column-visibility', JSON.stringify(columnVisibility));
            } catch (e) {
                console.error('Failed to save satellites table column visibility:', e);
            }
        }
    }, [columnVisibility]);

    // Add elevation to rows for sorting, but use useMemo to prevent unnecessary recalculations
    const satelliteRows = React.useMemo(() => {
        const positions = selectedSatellitePositionsRef.current();
        return (selectedSatellites || []).map(satellite => ({
            ...satellite,
            elevation: positions?.[satellite.norad_id]?.el ?? null,
        }));
    }, [selectedSatellites, selectedSatellitePositionsRef]);

    // Update rows with latest elevation data using apiRef to avoid full re-renders
    useEffect(() => {
        if (!apiRef.current?.updateRows || !satelliteRows.length) return;

        const updateElevations = () => {
            const positions = selectedSatellitePositionsRef.current();
            satelliteRows.forEach(row => {
                const elevation = positions?.[row.norad_id]?.el;
                if (elevation !== undefined) {
                    apiRef.current.updateRows([{ norad_id: row.norad_id, elevation }]);
                }
            });
        };

        // Initial update
        updateElevations();

        // Set up periodic updates every 2 seconds
        const interval = setInterval(updateElevations, 2000);

        return () => clearInterval(interval);
    }, [selectedSatellites, apiRef, satelliteRows, selectedSatellitePositionsRef]);

    useEffect(() => {
        dispatch(fetchSatelliteGroups({socket}))
            .unwrap()
            .then((data) => {
                if (data && selectedSatGroupId !== "" && selectedSatGroupId !== "none") {
                    // Verify the group ID exists in the loaded groups before fetching satellites
                    const groupExists = data.some(group => group.id === selectedSatGroupId);
                    if (groupExists) {
                        dispatch(fetchSatellitesByGroupId({socket: socket, satGroupId: selectedSatGroupId}));
                    } else {
                        console.warn(`Satellite group ${selectedSatGroupId} not found in loaded groups. Clearing selection.`);
                        dispatch(setSelectedSatGroupId(""));
                    }
                }
            })
            .catch((err) => {
                toast.error(t('satellite_selector.failed_load_groups') + ": " + err.message)
            });
    }, []);

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

    const handleOnRowClick = useCallback((params) => {
        dispatch(setSelectedSatelliteId(params.row.norad_id));
    }, [dispatch]);

    const handleColumnVisibilityChange = useCallback((newModel) => {
        dispatch(setSatellitesTableColumnVisibility(newModel));
    }, [dispatch]);

    const handlePageSizeChange = useCallback((newPageSize) => {
        dispatch(setSatellitesTablePageSize(newPageSize));
    }, [dispatch]);

    const handleSortModelChange = useCallback((newSortModel) => {
        dispatch(setSatellitesTableSortModel(newSortModel));
    }, [dispatch]);

    const handleOpenSettings = useCallback(() => {
        dispatch(setOpenSatellitesTableSettingsDialog(true));
    }, [dispatch]);

    const handleCloseSettings = useCallback(() => {
        dispatch(setOpenSatellitesTableSettingsDialog(false));
    }, [dispatch]);

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
                            {t('satellites_table.title')} ({t('satellites_table.satellites_count', { count: selectedSatellites?.length || 0 })})
                        </Typography>
                    </Box>
                    <Box sx={{ display: 'flex', gap: 0.5 }}>
                        <Tooltip title={t('satellites_table_settings.title')}>
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
                    </Box>
                </Box>
            </TitleBar>
            <div style={{ position: 'relative', display: 'block', height: '100%' }} ref={containerRef}>
                <div style={{
                    padding: '0rem 0rem 0rem 0rem',
                    display: 'flex',
                    flexDirection: 'column',
                    height: containerHeight - 25,
                    minHeight,
                }}>
                    {!selectedSatGroupId ? (
                        <Box
                            sx={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                height: '100%',
                            }}
                        >
                            <Typography variant="body2" sx={{ color: 'text.secondary', fontStyle: 'italic' }}>
                                {t('satellites_table.no_group_selected')}
                            </Typography>
                        </Box>
                    ) : (
                        <MemoizedStyledDataGrid
                            apiRef={apiRef}
                            satellites={satelliteRows}
                            onRowClick={handleOnRowClick}
                            selectedSatelliteId={selectedSatelliteId}
                            loadingSatellites={loadingSatellites}
                            columnVisibility={columnVisibility}
                            onColumnVisibilityChange={handleColumnVisibilityChange}
                            selectedSatellitePositionsRef={selectedSatellitePositionsRef}
                            pageSize={satellitesTablePageSize}
                            onPageSizeChange={handlePageSizeChange}
                            sortModel={satellitesTableSortModel}
                            onSortModelChange={handleSortModelChange}
                        />
                    )}
                </div>
            </div>
            <SatellitesTableSettingsDialog
                open={openSatellitesTableSettingsDialog}
                onClose={handleCloseSettings}
            />
        </>
    );
});

export default SatelliteDetailsTable;
