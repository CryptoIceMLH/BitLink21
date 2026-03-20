import React, { useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
    Box, Typography, Paper, Chip, LinearProgress, Tooltip
} from '@mui/material';
import SignalCellularAltIcon from '@mui/icons-material/SignalCellularAlt';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import LockIcon from '@mui/icons-material/Lock';
import { fetchStats } from './bitlink21-slice.jsx';
import { useSocket } from '../common/socket.jsx';

const BeaconLockBadge = ({ measuring, correcting }) => {
    const color = correcting ? 'success' : measuring ? 'warning' : 'default';
    const label = correcting ? 'Locked' : measuring ? 'Measuring' : 'Off';
    return (
        <Chip
            icon={<LockIcon />}
            label={label}
            color={color}
            size="small"
            variant="outlined"
        />
    );
};

const MetricCard = ({ label, value, unit, color }) => (
    <Paper variant="outlined" sx={{ p: 1.5, flex: 1, minWidth: 80, textAlign: 'center' }}>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
            {label}
        </Typography>
        <Typography variant="h6" sx={{ fontWeight: 700, color: color || 'text.primary', lineHeight: 1 }}>
            {value ?? '—'}
        </Typography>
        {unit && <Typography variant="caption" color="text.secondary">{unit}</Typography>}
    </Paper>
);

export const StatsCompact = () => {
    const dispatch = useDispatch();
    const {socket} = useSocket();
    const { stats, statsLoading, beaconMeasuring, beaconCorrecting, beaconOffset } = useSelector(state => state.bitlink21);

    useEffect(() => {
        if (!socket) return;
        dispatch(fetchStats({ socket }));
        const interval = setInterval(() => dispatch(fetchStats({ socket })), 10000);
        return () => clearInterval(interval);
    }, [socket, dispatch]);

    if (statsLoading && !stats) return <LinearProgress />;

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                <MetricCard label="RX Frames" value={stats?.total_received || 0} />
                <MetricCard label="Processed" value={stats?.total_processed || 0} />
                <MetricCard
                    label="Errors"
                    value={stats?.errors || 0}
                    color={stats?.errors > 0 ? '#f44336' : undefined}
                />
            </Box>
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                <BeaconLockBadge measuring={beaconMeasuring} correcting={beaconCorrecting} />
                {beaconOffset !== 0 && (
                    <Tooltip title="Beacon frequency offset">
                        <Chip
                            label={`${beaconOffset > 0 ? '+' : ''}${beaconOffset.toFixed(1)} Hz`}
                            size="small"
                            variant="outlined"
                        />
                    </Tooltip>
                )}
            </Box>
        </Box>
    );
};

export const StatsFullPanel = () => {
    const dispatch = useDispatch();
    const {socket} = useSocket();
    const { stats, beaconMeasuring, beaconCorrecting, beaconOffset, outbox } = useSelector(state => state.bitlink21);

    useEffect(() => {
        if (!socket) return;
        dispatch(fetchStats({ socket }));
    }, [socket, dispatch]);

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 1 }}>
                <SignalCellularAltIcon fontSize="small" /> SSP Statistics
            </Typography>

            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                <MetricCard label="Total Received" value={stats?.total_received || 0} />
                <MetricCard label="Processed" value={stats?.total_processed || 0} />
                <MetricCard label="Errors" value={stats?.errors || 0} color={stats?.errors > 0 ? '#f44336' : undefined} />
                <MetricCard label="TX Queued" value={outbox?.pending_count || 0} />
            </Box>

            {stats?.by_type && (
                <Box>
                    <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
                        By Payload Type
                    </Typography>
                    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                        {Object.entries(stats.by_type).map(([type, data]) => (
                            <Chip
                                key={type}
                                label={`${data.name || `Type ${type}`}: ${data.count || 0}`}
                                size="small"
                                variant="outlined"
                                icon={data.count > 0 ? <CheckCircleIcon /> : <ErrorOutlineIcon />}
                            />
                        ))}
                    </Box>
                </Box>
            )}

            <Box>
                <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
                    Beacon AFC
                </Typography>
                <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                    <BeaconLockBadge measuring={beaconMeasuring} correcting={beaconCorrecting} />
                    <MetricCard label="Drift" value={beaconOffset?.toFixed(1) || '0'} unit="Hz" />
                </Box>
            </Box>
        </Box>
    );
};

export default StatsFullPanel;
