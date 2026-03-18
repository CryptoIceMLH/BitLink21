import { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import {
    Box, Typography, Paper, TextField, Button, IconButton, List, ListItem,
    ListItemText, ListItemSecondaryAction, Dialog, DialogTitle, DialogContent,
    DialogActions, Divider, Alert, Chip, Tooltip, InputAdornment
} from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DeleteIcon from '@mui/icons-material/Delete';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import SaveIcon from '@mui/icons-material/Save';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import VpnKeyIcon from '@mui/icons-material/VpnKey';
import LockIcon from '@mui/icons-material/Lock';
import { useSocket } from '../common/socket.jsx';
import {
    fetchIdentity, setIdentity, fetchContacts, addContact, deleteContact,
    fetchConfig, setConfig
} from './bitlink21-slice.jsx';

const IdentityCard = ({ socket }) => {
    const dispatch = useDispatch();
    const { identity, identityLoading, identityError } = useSelector(state => state.bitlink21);
    const [npub, setNpub] = useState('');
    const [nsec, setNsec] = useState('');
    const [showNsec, setShowNsec] = useState(false);
    const [editing, setEditing] = useState(false);

    useEffect(() => {
        if (identity) {
            setNpub(identity.npub || '');
            setNsec(identity.nsec || '');
        }
    }, [identity]);

    const handleSave = async () => {
        await dispatch(setIdentity({ socket, npub, nsec }));
        setEditing(false);
        dispatch(fetchIdentity({ socket }));
    };

    const copyToClipboard = (text) => {
        navigator.clipboard.writeText(text);
    };

    return (
        <Paper sx={{ p: 3, mb: 3 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                <VpnKeyIcon sx={{ mr: 1 }} />
                <Typography variant="h6" sx={{ fontWeight: 600 }}>Nostr Identity</Typography>
            </Box>

            {identityError && <Alert severity="error" sx={{ mb: 2 }}>{identityError}</Alert>}

            {identity && !editing ? (
                <Box>
                    <Box sx={{ mb: 2 }}>
                        <Typography variant="caption" color="text.secondary">Public Key (NPUB)</Typography>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <Typography variant="body2" sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
                                {identity.npub}
                            </Typography>
                            <Tooltip title="Copy NPUB">
                                <IconButton size="small" onClick={() => copyToClipboard(identity.npub)}>
                                    <ContentCopyIcon fontSize="small" />
                                </IconButton>
                            </Tooltip>
                        </Box>
                    </Box>
                    <Button variant="outlined" size="small" onClick={() => setEditing(true)}>
                        Update Keys
                    </Button>
                </Box>
            ) : (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <TextField
                        label="NPUB (Public Key)"
                        value={npub}
                        onChange={e => setNpub(e.target.value)}
                        placeholder="npub1..."
                        size="small"
                        fullWidth
                        InputProps={{ sx: { fontFamily: 'monospace' } }}
                    />
                    <TextField
                        label="NSEC (Private Key)"
                        value={nsec}
                        onChange={e => setNsec(e.target.value)}
                        placeholder="nsec1..."
                        size="small"
                        fullWidth
                        type={showNsec ? 'text' : 'password'}
                        InputProps={{
                            sx: { fontFamily: 'monospace' },
                            endAdornment: (
                                <InputAdornment position="end">
                                    <IconButton size="small" onClick={() => setShowNsec(!showNsec)}>
                                        {showNsec ? <VisibilityOffIcon fontSize="small" /> : <VisibilityIcon fontSize="small" />}
                                    </IconButton>
                                </InputAdornment>
                            ),
                        }}
                    />
                    <Box sx={{ display: 'flex', gap: 1 }}>
                        <Button variant="contained" startIcon={<SaveIcon />} onClick={handleSave} disabled={!npub || !nsec}>
                            Save Identity
                        </Button>
                        {identity && (
                            <Button variant="outlined" onClick={() => setEditing(false)}>Cancel</Button>
                        )}
                    </Box>
                </Box>
            )}
        </Paper>
    );
};

const BroadcastKeyCard = ({ socket }) => {
    const dispatch = useDispatch();
    const { config } = useSelector(state => state.bitlink21);
    const [passphrase, setPassphrase] = useState('');
    const [showPassphrase, setShowPassphrase] = useState(false);

    useEffect(() => {
        dispatch(fetchConfig({ socket, key: 'broadcast_passphrase' }));
    }, [socket, dispatch]);

    useEffect(() => {
        if (config.broadcast_passphrase) {
            setPassphrase(config.broadcast_passphrase);
        }
    }, [config.broadcast_passphrase]);

    const handleSave = () => {
        dispatch(setConfig({ socket, key: 'broadcast_passphrase', value: passphrase }));
    };

    return (
        <Paper sx={{ p: 3, mb: 3 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                <LockIcon sx={{ mr: 1 }} />
                <Typography variant="h6" sx={{ fontWeight: 600 }}>Broadcast Encryption</Typography>
            </Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Shared passphrase for broadcast messages (PBKDF2-based encryption). All stations using the same passphrase can decrypt broadcast messages.
            </Typography>
            <Box sx={{ display: 'flex', gap: 1 }}>
                <TextField
                    label="Shared Passphrase"
                    value={passphrase}
                    onChange={e => setPassphrase(e.target.value)}
                    size="small"
                    fullWidth
                    type={showPassphrase ? 'text' : 'password'}
                    InputProps={{
                        endAdornment: (
                            <InputAdornment position="end">
                                <IconButton size="small" onClick={() => setShowPassphrase(!showPassphrase)}>
                                    {showPassphrase ? <VisibilityOffIcon fontSize="small" /> : <VisibilityIcon fontSize="small" />}
                                </IconButton>
                            </InputAdornment>
                        ),
                    }}
                />
                <Button variant="contained" onClick={handleSave} disabled={!passphrase}>Save</Button>
            </Box>
            {config.broadcast_passphrase && (
                <Chip label="Configured" color="success" size="small" sx={{ mt: 1 }} />
            )}
        </Paper>
    );
};

const ContactsList = ({ socket }) => {
    const dispatch = useDispatch();
    const { contacts, contactsLoading } = useSelector(state => state.bitlink21);
    const [addDialogOpen, setAddDialogOpen] = useState(false);
    const [newNpub, setNewNpub] = useState('');
    const [newNickname, setNewNickname] = useState('');

    const handleAdd = async () => {
        if (!newNpub) return;
        await dispatch(addContact({ socket, npub: newNpub, nickname: newNickname || null }));
        setNewNpub('');
        setNewNickname('');
        setAddDialogOpen(false);
    };

    const handleDelete = (npub) => {
        dispatch(deleteContact({ socket, npub }));
    };

    return (
        <Paper sx={{ p: 3 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                <Typography variant="h6" sx={{ fontWeight: 600, flex: 1 }}>Address Book</Typography>
                <Button startIcon={<PersonAddIcon />} variant="outlined" size="small" onClick={() => setAddDialogOpen(true)}>
                    Add Contact
                </Button>
            </Box>

            {contacts.length === 0 ? (
                <Typography color="text.secondary" sx={{ p: 2, textAlign: 'center' }}>
                    No contacts yet. Add contacts to easily send encrypted messages.
                </Typography>
            ) : (
                <List dense>
                    {contacts.map((contact, idx) => (
                        <Box key={contact.npub}>
                            {idx > 0 && <Divider />}
                            <ListItem>
                                <ListItemText
                                    primary={contact.nickname || 'Unnamed'}
                                    secondary={
                                        <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>
                                            {contact.npub}
                                        </Typography>
                                    }
                                />
                                <ListItemSecondaryAction>
                                    <Tooltip title="Copy NPUB">
                                        <IconButton size="small" onClick={() => navigator.clipboard.writeText(contact.npub)}>
                                            <ContentCopyIcon fontSize="small" />
                                        </IconButton>
                                    </Tooltip>
                                    <IconButton size="small" color="error" onClick={() => handleDelete(contact.npub)}>
                                        <DeleteIcon fontSize="small" />
                                    </IconButton>
                                </ListItemSecondaryAction>
                            </ListItem>
                        </Box>
                    ))}
                </List>
            )}

            <Dialog open={addDialogOpen} onClose={() => setAddDialogOpen(false)} maxWidth="sm" fullWidth>
                <DialogTitle>Add Contact</DialogTitle>
                <DialogContent>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
                        <TextField
                            label="NPUB"
                            value={newNpub}
                            onChange={e => setNewNpub(e.target.value)}
                            placeholder="npub1..."
                            fullWidth
                            required
                            InputProps={{ sx: { fontFamily: 'monospace' } }}
                        />
                        <TextField
                            label="Nickname (optional)"
                            value={newNickname}
                            onChange={e => setNewNickname(e.target.value)}
                            placeholder="Alice"
                            fullWidth
                        />
                    </Box>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setAddDialogOpen(false)}>Cancel</Button>
                    <Button variant="contained" onClick={handleAdd} disabled={!newNpub}>Add</Button>
                </DialogActions>
            </Dialog>
        </Paper>
    );
};

export default function IdentityPage() {
    const { t } = useTranslation('bitlink21');
    const dispatch = useDispatch();
    const socket = useSocket();

    useEffect(() => {
        if (!socket) return;
        dispatch(fetchIdentity({ socket }));
        dispatch(fetchContacts({ socket }));
    }, [socket, dispatch]);

    return (
        <Box sx={{ p: 3 }}>
            <Typography variant="h5" sx={{ fontWeight: 600, mb: 3 }}>
                {t('identity', 'Identity & Contacts')}
            </Typography>
            <IdentityCard socket={socket} />
            <BroadcastKeyCard socket={socket} />
            <ContactsList socket={socket} />
        </Box>
    );
}
