import { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import {
    Box, Typography, Paper, TextField, Button, Switch, FormControlLabel,
    Alert, Chip, Divider, InputAdornment, IconButton, CircularProgress
} from '@mui/material';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import SaveIcon from '@mui/icons-material/Save';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import CurrencyBitcoinIcon from '@mui/icons-material/CurrencyBitcoin';
import { useSocket } from '../common/socket.jsx';
import { fetchConfig, setConfig } from './bitlink21-slice.jsx';

const CONFIG_KEYS = {
    rpcUrl: 'bitcoin_rpc_url',
    rpcUser: 'bitcoin_rpc_user',
    rpcPass: 'bitcoin_rpc_pass',
    allowHighFees: 'bitcoin_allow_high_fees',
};

export default function BitcoinPage() {
    const { t } = useTranslation('bitlink21');
    const dispatch = useDispatch();
    const {socket} = useSocket();
    const { config } = useSelector(state => state.bitlink21);

    const [rpcUrl, setRpcUrl] = useState('http://localhost:8332');
    const [rpcUser, setRpcUser] = useState('');
    const [rpcPass, setRpcPass] = useState('');
    const [showPass, setShowPass] = useState(false);
    const [allowHighFees, setAllowHighFees] = useState(false);
    const [testResult, setTestResult] = useState(null);
    const [testing, setTesting] = useState(false);

    useEffect(() => {
        if (!socket) return;
        Object.values(CONFIG_KEYS).forEach(key => {
            dispatch(fetchConfig({ socket, key }));
        });
    }, [socket, dispatch]);

    useEffect(() => {
        if (config[CONFIG_KEYS.rpcUrl]) setRpcUrl(config[CONFIG_KEYS.rpcUrl]);
        if (config[CONFIG_KEYS.rpcUser]) setRpcUser(config[CONFIG_KEYS.rpcUser]);
        if (config[CONFIG_KEYS.rpcPass]) setRpcPass(config[CONFIG_KEYS.rpcPass]);
        if (config[CONFIG_KEYS.allowHighFees] !== undefined) setAllowHighFees(config[CONFIG_KEYS.allowHighFees] === 'true');
    }, [config]);

    const handleSave = () => {
        dispatch(setConfig({ socket, key: CONFIG_KEYS.rpcUrl, value: rpcUrl }));
        dispatch(setConfig({ socket, key: CONFIG_KEYS.rpcUser, value: rpcUser }));
        dispatch(setConfig({ socket, key: CONFIG_KEYS.rpcPass, value: rpcPass }));
        dispatch(setConfig({ socket, key: CONFIG_KEYS.allowHighFees, value: String(allowHighFees) }));
    };

    const handleTestConnection = async () => {
        setTesting(true);
        setTestResult(null);
        // Route through backend to avoid CORS issues
        if (socket) {
            socket.emit('data_submission', 'bitlink21:bitcoin_test_connection', {
                rpc_url: rpcUrl,
                rpc_user: rpcUser,
                rpc_pass: rpcPass,
            }, (res) => {
                if (res?.success) {
                    setTestResult({ success: true, message: res.data?.message || 'Connected!' });
                } else {
                    setTestResult({ success: false, message: res?.error || 'Connection failed' });
                }
                setTesting(false);
            });
        } else {
            setTestResult({ success: false, message: 'No socket connection' });
            setTesting(false);
        }
    };

    return (
        <Box sx={{ p: 3 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 3 }}>
                <CurrencyBitcoinIcon sx={{ mr: 1, fontSize: 32, color: '#f7931a' }} />
                <Typography variant="h5" sx={{ fontWeight: 600 }}>
                    {t('bitcoin', 'Bitcoin')}
                </Typography>
            </Box>

            <Paper sx={{ p: 3, mb: 3 }}>
                <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>Bitcoin Core RPC Connection</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    Connect to your Bitcoin Core node to relay raw transactions received over satellite.
                </Typography>

                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <TextField
                        label="RPC URL"
                        value={rpcUrl}
                        onChange={e => setRpcUrl(e.target.value)}
                        placeholder="http://localhost:8332"
                        size="small"
                        fullWidth
                    />
                    <Box sx={{ display: 'flex', gap: 2 }}>
                        <TextField
                            label="RPC User"
                            value={rpcUser}
                            onChange={e => setRpcUser(e.target.value)}
                            size="small"
                            sx={{ flex: 1 }}
                        />
                        <TextField
                            label="RPC Password"
                            value={rpcPass}
                            onChange={e => setRpcPass(e.target.value)}
                            size="small"
                            sx={{ flex: 1 }}
                            type={showPass ? 'text' : 'password'}
                            InputProps={{
                                endAdornment: (
                                    <InputAdornment position="end">
                                        <IconButton size="small" onClick={() => setShowPass(!showPass)}>
                                            {showPass ? <VisibilityOffIcon fontSize="small" /> : <VisibilityIcon fontSize="small" />}
                                        </IconButton>
                                    </InputAdornment>
                                ),
                            }}
                        />
                    </Box>
                    <FormControlLabel
                        control={<Switch checked={allowHighFees} onChange={e => setAllowHighFees(e.target.checked)} size="small" />}
                        label="Allow high fees"
                    />

                    <Divider />

                    <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                        <Button variant="contained" startIcon={<SaveIcon />} onClick={handleSave}>
                            Save Configuration
                        </Button>
                        <Button
                            variant="outlined"
                            onClick={handleTestConnection}
                            disabled={testing || !rpcUrl}
                            startIcon={testing ? <CircularProgress size={16} /> : null}
                        >
                            Test Connection
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
                <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>TX Relay History</Typography>
                <Typography variant="body2" color="text.secondary">
                    Bitcoin transactions received via satellite and relayed to the network will appear here.
                </Typography>
                <Box sx={{ p: 4, textAlign: 'center' }}>
                    <Typography color="text.secondary">No transactions relayed yet</Typography>
                </Box>
            </Paper>
        </Box>
    );
}
