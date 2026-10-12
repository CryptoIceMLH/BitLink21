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


import Stack from "@mui/material/Stack";
import {ThemeSwitcher} from "@toolpad/core/DashboardLayout";
import Typography from "@mui/material/Typography";
import PropTypes from "prop-types";
import * as React from "react";
import {Outlet, useNavigate, useLocation} from "react-router";
import {
    AppBar,
    Avatar,
    Backdrop,
    Box,
    Button,
    CssBaseline,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogContentText,
    DialogActions,
    Divider,
    Drawer,
    IconButton,
    List,
    ListItem,
    ListItemButton,
    ListItemIcon,
    ListItemText,
    MenuItem,
    MenuList,
    Toolbar,
    useTheme,
    styled
} from "@mui/material";
import {Account, AccountPopoverFooter, AccountPreview, SignOutButton} from "@toolpad/core";
import {BitLink21Logo} from "../common/dataurl-icons.jsx";
import {stringAvatar} from "../common/common.jsx";
import Grid from "@mui/material/Grid";
import {useCallback, useEffect, useRef, useState} from "react";
import {useSocket} from "../common/socket.jsx";
import {useDispatch, useSelector} from "react-redux";
import { useTranslation } from 'react-i18next';
import WakeLockStatus from "./wake-lock-icon.jsx";
import ConnectionStatus from "./connection-popover.jsx";
import Tooltip from "@mui/material/Tooltip";
import ConnectionOverlay from "./reconnecting-overlay.jsx";
import VersionInfo from "./version-info.jsx";
import VersionUpdateOverlay from "./version-update-overlay.jsx";
import UpdateIndicator from "./update-indicator.jsx";
import PerformanceMetricsDialog from "../performance/performance-metrics-dialog.jsx";
import BackgroundTasksPopover from "../tasks/tasks-popover.jsx";
import MenuIcon from '@mui/icons-material/Menu';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import {getNavigation} from "../../config/navigation.jsx";
import { useUserTimeSettings } from '../../hooks/useUserTimeSettings.jsx';
import { formatTime } from '../../utils/date-time.js';

// Drawer widths
const drawerWidthExpanded = 240;
const drawerWidthCollapsed = 56;

// Styled components
const openedMixin = (theme) => ({
    width: drawerWidthExpanded,
    transition: theme.transitions.create('width', {
        easing: theme.transitions.easing.sharp,
        duration: theme.transitions.duration.enteringScreen,
    }),
    overflowX: 'hidden',
});

const closedMixin = (theme) => ({
    transition: theme.transitions.create('width', {
        easing: theme.transitions.easing.sharp,
        duration: theme.transitions.duration.leavingScreen,
    }),
    overflowX: 'hidden',
    width: drawerWidthCollapsed,
});

const CustomDrawer = styled(Drawer, { shouldForwardProp: (prop) => prop !== 'open' })(
    ({ theme, open }) => ({
        width: open ? drawerWidthExpanded : drawerWidthCollapsed,
        flexShrink: 0,
        whiteSpace: 'nowrap',
        boxSizing: 'border-box',
        ...(open && {
            ...openedMixin(theme),
            '& .MuiDrawer-paper': openedMixin(theme),
        }),
        ...(!open && {
            ...closedMixin(theme),
            '& .MuiDrawer-paper': closedMixin(theme),
        }),
    }),
);

const CustomAppBar = styled(AppBar, {
    shouldForwardProp: (prop) => prop !== 'open',
})(({ theme, open }) => ({
    zIndex: theme.zIndex.drawer + 1,
}));


function ToolbarActions() {
    return (
        <Stack direction="row" sx={{padding: "6px 0px 0px 0px"}}>
            <ConnectionStatus />
            <BackgroundTasksPopover />
            <WakeLockStatus />
            <TimeDisplay />
            <ThemeSwitcher />
        </Stack>
    );
}

function SidebarFooter({ mini }) {
    return (
        <Typography variant="caption" sx={{ m: 1, whiteSpace: 'nowrap', overflow: 'hidden' }}>
            {mini ? '© MUI' : `© ${new Date().getFullYear()} Made with love by MUI`}
        </Typography>
    );
}

SidebarFooter.propTypes = {
    mini: PropTypes.bool.isRequired,
};

function CustomAppTitle() {
    return (
        <Grid container direction="row">
            <Grid row={1} column={1} sx={{display: 'flex', alignItems: 'center'}}>
                <Stack direction="row" alignItems="center" spacing={2}>
                    <Box display={{xs: "none", sm: "block"}}>
                        <Box display="flex" alignItems="center" gap={1}>
                            <img src={BitLink21Logo} alt="BitLink21" width="30" height="30" />
                            <Typography variant="h6">BitLink21</Typography>
                            {/* Hide version indicator on phones and small tablets; show from ~768px and up */}
                            <Box sx={{
                                display: 'none',
                                '@media (min-width:768px)': {
                                    display: 'block',
                                },
                            }}>
                                <Stack direction="row" spacing={1} alignItems="center">
                                    <VersionInfo minimal={true}/>
                                    <UpdateIndicator />
                                </Stack>
                            </Box>
                        </Box>
                    </Box>
                    <Box display={{xs: "block", sm: "none"}}>
                        <Typography variant="h6"></Typography>
                    </Box>
                </Stack>
            <Grid/>
            <Grid spacing={3} row={1} column={1}>
                <Grid container direction="row" spacing={4}>
                    <Grid>
                    </Grid>
                </Grid>
            </Grid>
            </Grid>
        </Grid>
    );
}

function AccountSidebarPreview(props) {
    const { handleClick, open, mini } = props;
    return (
        <Stack direction="column" p={0}>
            <Divider />
            <AccountPreview
                variant={mini ? 'condensed' : 'expanded'}
                handleClick={handleClick}
                open={open}
            />
        </Stack>
    );
}

AccountSidebarPreview.propTypes = {
    /**
     * The handler used when the preview is expanded
     */
    handleClick: PropTypes.func,
    mini: PropTypes.bool.isRequired,
    /**
     * The state of the Account popover
     * @default false
     */
    open: PropTypes.bool,
};

const accounts = [
    {
        id: 1,
        name: 'Efstratios Goudelis',
        email: 'sgoudelis@nerv.home',
        image: null,
        projects: [
            {
                id: 3,
                title: 'Project X',
            },
        ],
    }
];

function TimeDisplay() {
    const [isUTC, setIsUTC] = React.useState(false); // Toggle between UTC and Local Time
    const [currentTime, setCurrentTime] = React.useState(new Date());
    const { timezone, locale } = useUserTimeSettings();

    // Update the time every second
    React.useEffect(() => {
        const interval = setInterval(() => setCurrentTime(new Date()), 1000);
        return () => clearInterval(interval); // Cleanup on unmount
    }, []);

    // Format time based on whether it's UTC or local
    const formattedTime = isUTC
        ? formatTime(currentTime, {
            timezone: 'UTC',
            locale,
            options: { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false },
        })
        : formatTime(currentTime, {
            timezone,
            locale,
            options: { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false },
        });

    const timeZoneAbbr = isUTC
        ? 'UTC'
        : new Intl.DateTimeFormat(locale, { timeZone: timezone, timeZoneName: 'short' })
            .formatToParts(currentTime)
            .find((part) => part.type === 'timeZoneName')?.value || timezone;

    return (
        <Box
            onClick={() => setIsUTC(!isUTC)} // Toggle between UTC and Local Time on click
            sx={{
                cursor: "pointer",
                p: 0,
                paddingTop: 0.75,
                paddingBottom: 0,
                borderRadius: "4px",
                textAlign: "center",
                maxWidth: "100px",
                display: "flex",
                flexDirection: "column",
                alignItems: "center"
            }}
        >
            <Typography variant="body2" sx={{fontSize: "0.65rem", fontWeight: "bold", fontFamily: "monospace"}}>
                {formattedTime}
            </Typography>
            <Typography variant="caption" sx={{fontSize: "0.65rem", fontFamily: "monospace", color: "#aaa"}}>
                {isUTC ? "UTC" : timeZoneAbbr}
            </Typography>
        </Box>
    );
}

function SidebarFooterAccountPopover() {
    return (
        <Stack direction="column" sx={{
            pl: '0px',
            pr: '0px',
        }}>
            <Typography variant="body2" mx={2} mt={1}>
                Accounts
            </Typography>
            <MenuList>
                {accounts.map((account) => (
                    <MenuItem
                        key={account.id}
                        component="button"
                        sx={{
                            justifyContent: 'flex-start',
                            width: '100%',
                            columnGap: 2,
                        }}
                    >
                        <ListItemIcon>
                            <Avatar {...stringAvatar('My Name')} />
                        </ListItemIcon>
                        <ListItemText
                            sx={{
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'flex-start',
                                width: '100%',
                            }}
                            primary={account.name}
                            secondary={account.email}
                        />
                    </MenuItem>
                ))}
            </MenuList>
            <Divider />
            <AccountPopoverFooter>
                <SignOutButton />
            </AccountPopoverFooter>
        </Stack>
    );
}

function SidebarFooterAccount({ mini }) {
    const PreviewComponent = React.useMemo(() => createPreviewComponent(mini), [mini]);
    return (
        <Account
            slots={{
                preview: PreviewComponent,
                popoverContent: SidebarFooterAccountPopover,
            }}
            slotProps={{
                popover: {
                    transformOrigin: { horizontal: 'left', vertical: 'bottom' },
                    anchorOrigin: { horizontal: 'right', vertical: 'bottom' },
                    disableAutoFocus: true,
                    slotProps: {
                        paper: {
                            elevation: 0,
                            sx: {
                                overflow: 'visible',
                                // filter: (theme) => `drop-shadow(0px 2px 8px ${theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.32)'})`,
                                mt: 1,
                                '&::before': {
                                    content: '""',
                                    display: 'block',
                                    position: 'absolute',
                                    bottom: 10,
                                    left: 0,
                                    width: 10,
                                    height: 10,
                                    bgcolor: 'background.paper',
                                    transform: 'translate(-50%, -50%) rotate(45deg)',
                                    zIndex: 0,
                                },
                            },
                        },
                    },
                },
            }}
        />
    );
}

SidebarFooterAccount.propTypes = {
    mini: PropTypes.bool.isRequired,
};

const createPreviewComponent = (mini) => {
    function PreviewComponent(props) {
        return <AccountSidebarPreview {...props} mini={mini} />;
    }
    return PreviewComponent;
};

export default function Layout() {
    const theme = useTheme();
    const dispatch = useDispatch();
    const navigate = useNavigate();
    const location = useLocation();
    const { socket } = useSocket();
    const { t } = useTranslation();
    const [open, setOpen] = React.useState(false);
    const [mobileOpen, setMobileOpen] = React.useState(false);
    const [navigation, setNavigation] = React.useState(getNavigation());
    const { timezone, locale } = useUserTimeSettings();

    const {
        connecting,
        connected,
        disconnected,
        reConnectAttempt,
        connectionError,
        initialDataLoading,
    } = useSelector((state) => state.dashboard);
    const {
        hasVersionChanged,
        data
    } = useSelector((state) => state.version);

    // Update navigation when language changes or state changes
    React.useEffect(() => {
        setNavigation(getNavigation());
    }, [t]);

    const handleDrawerToggle = () => {
        // On mobile, toggle the temporary drawer
        if (window.innerWidth < 600) {
            setMobileOpen(!mobileOpen);
        } else {
            // On desktop, toggle between collapsed/expanded
            setOpen(!open);
        }
    };

    const handleMobileDrawerClose = () => {
        setMobileOpen(false);
    };

    const handleNavigation = (segment) => {
        navigate(`/${segment}`);
        // Close mobile drawer after navigation
        if (window.innerWidth < 600) {
            setMobileOpen(false);
        }
    };

    const isActiveRoute = (segment) => {
        const currentPath = location.pathname.slice(1); // Remove leading slash
        if (segment === '' && currentPath === '') return true;
        if (segment && currentPath.startsWith(segment)) return true;
        return false;
    };

    // Get scheduler state for dynamic tooltip
    const schedulerObservations = useSelector((state) => state.scheduler?.observations || []);

    /**
     * Get comprehensive scheduler observation information
     * Returns details about running observation and next upcoming observation
     */
    const getSchedulerObservationInfo = () => {
        const now = new Date();

        // Find running observation
        const runningObservation = schedulerObservations.find(
            obs => obs.status === 'running' && obs.enabled
        );

        // Find next enabled scheduled observation
        const nextObservation = schedulerObservations
            .filter(obs => obs.status === 'scheduled' && obs.enabled && obs.pass?.event_start)
            .map(obs => ({
                ...obs,
                startTime: new Date(obs.pass.event_start),
            }))
            .filter(obs => obs.startTime > now)
            .sort((a, b) => a.startTime - b.startTime)[0];

        return { runningObservation, nextObservation };
    };

    const { runningObservation, nextObservation } = getSchedulerObservationInfo();

    // Helper function to format time remaining/until
    const formatTimeUntil = (targetDate) => {
        const now = new Date();
        const ms = targetDate - now;
        const hours = Math.floor(ms / 3600000);
        const minutes = Math.floor((ms % 3600000) / 60000);

        if (hours > 24) {
            const days = Math.floor(hours / 24);
            return `${days}d ${hours % 24}h`;
        } else if (hours > 0) {
            return `${hours}h ${minutes}m`;
        } else {
            return `${minutes}m`;
        }
    };

    // Helper function to get tooltip text
    const getTooltipText = (item, drawerExpanded) => {
        if (!drawerExpanded) {
            // For scheduler, show comprehensive dynamic tooltip
            if (item.segment === 'scheduler') {
                const parts = [];

                // Show running observation
                if (runningObservation) {
                    const satelliteName = runningObservation.satellite?.name || 'Unknown';
                    const endTime = runningObservation.pass?.event_end
                        ? formatTime(runningObservation.pass.event_end, {
                            timezone,
                            locale,
                            options: { hour: '2-digit', minute: '2-digit', hour12: false },
                          })
                        : 'N/A';
                    const remainingTime = runningObservation.pass?.event_end
                        ? formatTimeUntil(new Date(runningObservation.pass.event_end))
                        : 'N/A';
                    parts.push(`⚫ Active: ${satelliteName} (${remainingTime} left, ends ${endTime})`);
                }

                // Show next observation
                if (nextObservation) {
                    const satelliteName = nextObservation.satellite?.name || 'Unknown';
                    const startTime = nextObservation.pass?.event_start
                        ? formatTime(nextObservation.pass.event_start, {
                            timezone,
                            locale,
                            options: { hour: '2-digit', minute: '2-digit', hour12: false },
                          })
                        : 'N/A';
                    const timeUntil = nextObservation.pass?.event_start
                        ? formatTimeUntil(new Date(nextObservation.pass.event_start))
                        : 'N/A';
                    const prefix = runningObservation ? '\n⏱ Next: ' : '⏱ Next: ';
                    parts.push(`${prefix}${satelliteName} (in ${timeUntil}, starts ${startTime})`);
                }

                // If we have info to show, return it; otherwise fall back to title
                if (parts.length > 0) {
                    return parts.join('');
                }
            }
            return item.title;
        }
        return '';
    };

    // Drawer content component
    const drawerContent = (isExpanded) => (
        <>
            <Toolbar />
            <Box component="nav" role="navigation" aria-label="Main navigation" sx={{ overflow: 'auto', mt: 1 }}>
                <List>
                    {navigation.map((item, index) => {
                        if (item.kind === 'header') {
                            return isExpanded ? (
                                <ListItem key={index} sx={{ pt: 2, pb: 1 }}>
                                    <Typography
                                        variant="caption"
                                        sx={{
                                            fontWeight: 'bold',
                                            color: 'text.secondary',
                                            pl: 2
                                        }}
                                    >
                                        {item.title}
                                    </Typography>
                                </ListItem>
                            ) : null;
                        }

                        if (item.kind === 'divider') {
                            return <Divider key={index} sx={{ my: 1 }} />;
                        }

                        const isActive = isActiveRoute(item.segment);

                        return (
                            <ListItem key={index} disablePadding sx={{ display: 'block' }}>
                                <Tooltip
                                    title={getTooltipText(item, isExpanded)}
                                    placement="right"
                                    disableFocusListener
                                    disableTouchListener
                                >
                                    <ListItemButton
                                        onClick={() => handleNavigation(item.segment)}
                                        selected={isActive}
                                        sx={{
                                            minHeight: 40,
                                            justifyContent: isExpanded ? 'flex-start' : 'center',
                                            px: isExpanded ? 2 : 0,
                                            py: 0.75,
                                            display: 'flex',
                                            alignItems: 'center',
                                        }}
                                    >
                                        <ListItemIcon
                                            sx={{
                                                minWidth: 0,
                                                mr: isExpanded ? 2 : 0,
                                                display: 'flex',
                                                justifyContent: 'center',
                                                alignItems: 'center',
                                            }}
                                        >
                                            {item.icon}
                                        </ListItemIcon>
                                        {isExpanded && (
                                            <ListItemText
                                                primary={item.title}
                                                sx={{
                                                    '& .MuiTypography-root': {
                                                        fontSize: '0.875rem'
                                                    }
                                                }}
                                            />
                                        )}
                                    </ListItemButton>
                                </Tooltip>
                            </ListItem>
                        );
                    })}
                </List>
            </Box>
        </>
    );

    return (
        <Box sx={{ display: 'flex', minHeight: '100vh', overflow: 'hidden' }}>
            <CssBaseline />
            <CustomAppBar position="fixed" open={open}>
                <Toolbar>
                    <IconButton
                        color="inherit"
                        aria-label="toggle drawer"
                        onClick={handleDrawerToggle}
                        edge="start"
                        sx={{ mr: 2 }}
                    >
                        {open ? <ChevronLeftIcon /> : <MenuIcon />}
                    </IconButton>
                    <Box sx={{ flexGrow: 1 }}>
                        <CustomAppTitle />
                    </Box>
                    <ToolbarActions />
                </Toolbar>
            </CustomAppBar>

            {/* Mobile drawer - temporary */}
            <Drawer
                variant="temporary"
                open={mobileOpen}
                onClose={handleMobileDrawerClose}
                ModalProps={{
                    keepMounted: true, // Better open performance on mobile
                }}
                PaperProps={{
                    role: 'navigation',
                    'aria-label': 'Mobile navigation',
                }}
                sx={{
                    display: { xs: 'block', sm: 'none' },
                    '& .MuiDrawer-paper': {
                        width: drawerWidthExpanded,
                        boxSizing: 'border-box',
                    },
                }}
            >
                {drawerContent(true)}
            </Drawer>

            {/* Desktop drawer - permanent */}
            <CustomDrawer
                variant="permanent"
                open={open}
                PaperProps={{
                    role: 'navigation',
                    'aria-label': 'Desktop navigation',
                }}
                ModalProps={{
                    disableEnforceFocus: true,
                    disableAutoFocus: true,
                }}
                sx={{
                    display: { xs: 'none', sm: 'block' },
                    flexShrink: 0,
                }}
            >
                {drawerContent(open)}
            </CustomDrawer>

            <Box
                component="main"
                sx={{
                    flexGrow: 1,
                    mt: '52px',
                    minWidth: 0,
                }}
            >
                {connected && !initialDataLoading ? <Outlet /> : <ConnectionOverlay />}
                {hasVersionChanged && <VersionUpdateOverlay />}
                <PerformanceMetricsDialog />
            </Box>

        </Box>
    );
}
