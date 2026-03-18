import { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import {
    Box, Typography, Paper, TextField, Button, Alert, Chip, Divider,
    InputAdornment, IconButton, CircularProgress
} from '@mui/material';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import SaveIcon from '@mui/icons-material/Save';
import BoltIcon from '@mui/icons-material/Bolt';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import { useSocket } from '../common/socket.jsx';
import { fetchConfig, setConfig } from './bitlink21-slice.jsx';

const CONFIG_KEYS = {
    lndRestUrl: 'lightning_lnd_rest_url',
    lndCertPath: 'lightning_lnd_cert_path',
    lndMacaroonPath: 'lightning_lnd_macaroon_path',
};

export default function LightningPage() {
    const { t } = useTranslation('bitlink21');
    const dispatch = useDispatch();
    const socket = useSocket();
    const { config } = useSelector(state => state.bitlink21);

    const [lndRestUrl, setLndRestUrl] = useState('https://localhost:8080');
    const [lndCertPath, setLndCertPath] = useState('');
    const [lndMacaroonPath, setLndMacaroonPath] = useState('');
    const [testResult, setTestResult] = useState(null);
    const [testing, setTesting] = useState(false);

    useEffect(() => {
        if (!socket) return;
        Object.values(CONFIG_KEYS).forEach(key => {
            dispatch(fetchConfig({ socket, key }));
        });
    }, [socket, dispatch]);

    useEffect(() => {
        if (config[CONFIG_KEYS.lndRestUrl]) setLndRestUrl(config[CONFIG_KEYS.lndRestUrl]);
        if (config[CONFIG_KEYS.lndCertPath]) setLndCertPath(config[CONFIG_KEYS.lndCertPath]);
        if (config[CONFIG_KEYS.lndMacaroonPath]) setLndMacaroonPath(config[CONFIG_KEYS.lndMacaroonPath]);
    }, [config]);

    const handleSave = () => {
        dispatch(setConfig({ socket, key: CONFIG_KEYS.lndRestUrl, value: lndRestUrl }));
        dispatch(setConfig({ socket, key: CONFIG_KEYS.lndCertPath, value: lndCertPath }));
        dispatch(setConfig({ socket, key: CONFIG_KEYS.lndMacaroonPath, value: lndMacaroonPath }));
    };

    const isConfigured = config[CONFIG_KEYS.lndRestUrl];

    return (
        <Box sx={{ p: 3 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 3 }}>
                <BoltIcon sx={{ mr: 1, fontSize: 32, color: '#f7931a' }} />
                <Typography variant="h5" sx={{ fontWeight: 600 }}>
                    {t('lightning', 'Lightning')}
                </Typography>
                {isConfigured && <Chip label="Configured" color="success" size="small" sx={{ ml: 2 }} />}
            </Box>

            <Paper sx={{ p: 3, mb: 3 }}>
                <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>LND Connection</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    Connect to your Lightning Network Daemon (LND) to track payment status of invoices received via satellite.
                </Typography>

                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <TextField
                        label="LND REST URL"
                        value={lndRestUrl}
                        onChange={e => setLndRestUrl(e.target.value)}
                        placeholder="https://localhost:8080"
                        size="small"
                        fullWidth
                    />
                    <TextField
                        label="TLS Certificate Path"
                        value={lndCertPath}
                        onChange={e => setLndCertPath(e.target.value)}
                        placeholder="/path/to/tls.cert"
                        size="small"
                        fullWidth
                    />
                    <TextField
                        label="Macaroon Path"
                        value={lndMacaroonPath}
                        onChange={e => setLndMacaroonPath(e.target.value)}
                        placeholder="/path/to/admin.macaroon"
                        size="small"
                        fullWidth
                    />

                    <Divider />

                    <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                        <Button variant="contained" startIcon={<SaveIcon />} onClick={handleSave}>
                            Save Configuration
                        </Button>
                    </Box>

                    {testResult && (
                        <Alert
                            severity={testResult.success ? 'success' : 'error'}
                            icon={testResult.success ? <CheckCircleIcon /> : <ErrorIcon />}
                        >
                            {testResult.message}
                        </Alert>
                    )}
                </Box>
            </Paper>

            <Paper sx={{ p: 3 }}>
                <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>Received Invoices</Typography>
                <Typography variant="body2" color="text.secondary">
                    BOLT11 Lightning invoices received via satellite will appear here with payment status and QR codes.
                </Typography>
                <Box sx={{ p: 4, textAlign: 'center' }}>
                    <Typography color="text.secondary">No invoices received yet</Typography>
                </Box>
            </Paper>
        </Box>
    );
}
