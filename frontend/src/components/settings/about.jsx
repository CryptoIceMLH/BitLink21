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

import React from "react";
import { useSelector } from "react-redux";
import {
    Box,
    Typography,
    CardContent,
    Paper,
    Divider,
    Card,
    Stack,
    Chip,
    useTheme,
    Link,
} from "@mui/material";
import { GroundStationLogoGreenBlue } from "../common/dataurl-icons.jsx";
import SatelliteAltIcon from '@mui/icons-material/SatelliteAlt';
import SettingsInputAntennaIcon from '@mui/icons-material/SettingsInputAntenna';
import RadioIcon from '@mui/icons-material/Radio';
import ImageIcon from '@mui/icons-material/Image';
import DevicesIcon from '@mui/icons-material/Devices';
import CodeIcon from '@mui/icons-material/Code';
import StorageIcon from '@mui/icons-material/Storage';
import WebIcon from '@mui/icons-material/Web';
import InfoIcon from '@mui/icons-material/Info';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import MemoryIcon from '@mui/icons-material/Memory';
import ComputerIcon from '@mui/icons-material/Computer';
import Grid from "@mui/material/Grid";


const AboutPage = () => {
    const theme = useTheme();
    const versionInfo = useSelector((state) => state.version?.data);

    const featureItems = [
        {
            text: "Real-time Satellite Tracking: Track hundreds of satellites with high-precision orbital models. TLE data is automatically updated from CelesTrak and SatNOGS.",
            icon: <SatelliteAltIcon fontSize="small" color="primary" />
        },
        {
            text: "Automated Antenna Rotator Control: Interface with popular antenna rotators to automatically track satellites as they pass overhead.",
            icon: <SettingsInputAntennaIcon fontSize="small" color="primary" />
        },
        {
            text: "SDR Integration: Stream and record live radio signals from a wide range of SDR devices, including RTL-SDR, SoapySDR, and UHD/USRP radios.",
            icon: <RadioIcon fontSize="small" color="primary" />
        },
        {
            text: "IQ Recording & Playback: Record raw IQ data in SigMF format with complete metadata and play back recordings through a virtual SDR device for analysis and debugging.",
            icon: <StorageIcon fontSize="small" color="primary" />
        },
        {
            text: "Data Decoding: Decode SSTV, FSK, GFSK, GMSK, and BPSK with AX25 USP Geoscan framing. LoRa and AFSK decoders are currently not working; help is needed.",
            icon: <ImageIcon fontSize="small" color="primary" />
        },
        {
            text: "AI-Powered Transcription: Real-time speech-to-text for demodulated audio via Gemini Live or Deepgram. Privacy-conscious and user-keyed, with optional translation and file output to backend/data/transcriptions/.",
            icon: <MemoryIcon fontSize="small" color="primary" />
        },
        {
            text: "Scheduled Observations: Define detailed observation tasks that automatically listen, decode, transcribe, and record audio and IQ during satellite passes without manual intervention.",
            icon: <SatelliteAltIcon fontSize="small" color="primary" />
        },
        {
            text: "SatDump Integration: Decode weather satellite images from METEOR-M2 (LRPT and HRPT) via SatDump, coupled with automated observations.",
            icon: <ImageIcon fontSize="small" color="primary" />
        },
        {
            text: "Performance Monitoring: Real-time visualization of the signal processing pipeline showing data flow, queue health, throughput rates, and component statistics to diagnose bottlenecks and optimize performance.",
            icon: <ComputerIcon fontSize="small" color="primary" />
        },
        {
            text: "Responsive Web Interface: A modern, responsive, and intuitive web interface built with Material-UI that adapts seamlessly to desktop, tablet, and mobile devices, allowing you to control all aspects of the ground station from anywhere on your network. Works great on a tablet and cell.",
            icon: <DevicesIcon fontSize="small" color="primary" />
        }
    ];

    const plannedFeatures = [
        {
            text: "Additional Decoders: AFSK packet decoder.",
            icon: <SatelliteAltIcon fontSize="small" color="secondary" />
        },
        {
            text: "Additional Decoders: LoRa decoders.",
            icon: <RadioIcon fontSize="small" color="secondary" />
        },
        {
            text: "Additional Decoders: NOAA APT weather satellite images.",
            icon: <ImageIcon fontSize="small" color="secondary" />
        },
        {
            text: "Additional Decoders: Additional telemetry formats.",
            icon: <CodeIcon fontSize="small" color="secondary" />
        }
    ];

    const backendTechnologies = [
        { name: "FastAPI", description: "A modern, fast (high-performance), web framework for building APIs with Python 3.7+ based on standard Python type hints.", url: "https://fastapi.tiangolo.com/" },
        { name: "SQLAlchemy", description: "The Python SQL Toolkit and Object Relational Mapper that gives application developers the full power and flexibility of SQL.", url: "https://www.sqlalchemy.org/" },
        { name: "Skyfield", description: "A modern astronomy library for Python that computes positions for the stars, planets, and satellites in orbit around the Earth.", url: "https://rhodesmill.org/skyfield/" },
        { name: "SGP4", description: "A Python implementation of the SGP4 satellite propagation model.", url: "https://pypi.org/project/sgp4/" },
        { name: "Socket.IO", description: "A library for real-time, bidirectional, event-based communication.", url: "https://python-socketio.readthedocs.io/en/latest/" },
        { name: "pyrtlsdr", description: "A Python wrapper for the RTL-SDR library.", url: "https://pypi.org/project/pyrtlsdr/" },
        { name: "SoapySDR", description: "A vendor and platform neutral SDR support library.", url: "https://pypi.org/project/SoapySDR/" },
        { name: "SatDump", description: "Satellite decoder suite used for weather image decoding workflows.", url: "https://github.com/SatDump/SatDump" },
        { name: "gr-satellites", description: "GNU Radio out-of-tree modules for satellite communications decoding.", url: "https://github.com/daniestevez/gr-satellites" }
    ];

    const frontendTechnologies = [
        { name: "React", description: "A JavaScript library for building user interfaces.", url: "https://reactjs.org/" },
        { name: "Redux Toolkit", description: "The official, opinionated, batteries-included toolset for efficient Redux development.", url: "https://redux-toolkit.js.org/" },
        { name: "Material-UI", description: "A popular React UI framework with a comprehensive suite of UI tools.", url: "https://mui.com/" },
        { name: "Vite", description: "A build tool that aims to provide a faster and leaner development experience for modern web projects.", url: "https://vitejs.dev/" },
        { name: "Socket.IO Client", description: "The client-side library for Socket.IO.", url: "https://socket.io/docs/v4/client-api/" },
        { name: "Leaflet", description: "An open-source JavaScript library for mobile-friendly interactive maps.", url: "https://leafletjs.com/" },
        { name: "satellite.js", description: "A JavaScript library to propagate satellite orbits.", url: "https://github.com/shashwatak/satellite-js" }
    ];

    const sdrSupport = [
        "RTL-SDR (USB or rtl_tcp) workers",
        "SoapySDR devices locally or through SoapyRemote (Airspy, HackRF, LimeSDR, etc.)",
        "UHD/USRP radios via a UHD worker"
    ];

    return (
        <Paper
            elevation={1}
            sx={{
                padding: 1,
                marginTop: 0,
                borderRadius: 2,
            }}
        >
            <CardContent>
                <Box
                    sx={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "left",
                        textAlign: "left",
                        gap: 4,
                    }}
                >
                    {/* Header with logo */}
                    <Box
                        sx={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            marginBottom: 2,
                            borderBottom: `1px solid ${theme.palette.divider}`,
                            paddingBottom: 2,
                            flexWrap: "wrap",
                            gap: 2,
                        }}
                    >
                        <Box sx={{ display: "flex", alignItems: "center" }}>
                            <img
                                src={GroundStationLogoGreenBlue}
                                alt="Ground Station Logo"
                                style={{ height: "70px", marginRight: "20px" }}
                            />
                            <Typography
                                variant="h3"
                                sx={{
                                    margin: '9px',
                                    fontWeight: 600,
                                    background: `linear-gradient(90deg, ${theme.palette.primary.main}, ${theme.palette.secondary.main})`,
                                    WebkitBackgroundClip: 'text',
                                    WebkitTextFillColor: 'transparent',
                                }}
                            >
                                Ground Station
                            </Typography>
                        </Box>
                        
                        {/* Version Information - Compact */}
                        {versionInfo && (
                            <Card elevation={2} sx={{ 
                                p: 1.5, 
                                backgroundColor: 'rgba(33, 150, 243, 0.05)', 
                                border: `1px solid ${theme.palette.primary.main}30`,
                                minWidth: 200,
                            }}>
                                <Stack spacing={1}>
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                        <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', minWidth: 60 }}>
                                            Version:
                                        </Typography>
                                        <Chip 
                                            label={versionInfo.version} 
                                            color="primary" 
                                            size="small"
                                            sx={{ fontFamily: 'monospace', fontWeight: 600, height: 20, fontSize: '0.75rem' }}
                                        />
                                    </Box>
                                    
                                    {versionInfo.environment && (
                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                            <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', minWidth: 60 }}>
                                                Env:
                                            </Typography>
                                            <Chip 
                                                label={versionInfo.environment} 
                                                color={versionInfo.environment === 'production' ? 'success' : 'warning'}
                                                size="small"
                                                sx={{ fontFamily: 'monospace', textTransform: 'capitalize', height: 20, fontSize: '0.75rem' }}
                                            />
                                        </Box>
                                    )}
                                    
                                    {versionInfo.buildDate && (
                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                            <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', minWidth: 60 }}>
                                                Build:
                                            </Typography>
                                            <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>
                                                {versionInfo.buildDate.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3')}
                                            </Typography>
                                        </Box>
                                    )}
                                    
                                    {versionInfo.gitCommit && (
                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                            <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', minWidth: 60 }}>
                                                Commit:
                                            </Typography>
                                            <Chip 
                                                label={versionInfo.gitCommit} 
                                                size="small"
                                                variant="outlined"
                                                sx={{ fontFamily: 'monospace', height: 20, fontSize: '0.75rem' }}
                                            />
                                        </Box>
                                    )}
                                    
                                    {versionInfo.system?.cpu?.architecture && (
                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                            <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', minWidth: 60 }}>
                                                Arch:
                                            </Typography>
                                            <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>
                                                {versionInfo.system.cpu.architecture}
                                            </Typography>
                                        </Box>
                                    )}
                                </Stack>
                            </Card>
                        )}
                    </Box>

                    {/* Introduction */}
                    <Card elevation={1} sx={{ padding: 2, backgroundColor: 'rgba(255,255,255,0.05)' }}>
                        <Typography variant="body1" paragraph sx={{ fontSize: '1.1rem', lineHeight: 1.6 }}>
                            <strong>Ground Station is a full-featured, open-source software solution for satellite tracking and radio communication.</strong> Designed for amateur radio operators, satellite enthusiasts, and researchers, it provides a comprehensive and easy-to-use platform for monitoring spacecraft, controlling radio equipment, and receiving live radio signals from satellites.
                        </Typography>
                        <Typography variant="body2">
                            <Link
                                href="https://github.com/sgoudelis/ground-station"
                                target="_blank"
                                rel="noopener noreferrer"
                                sx={{ display: "inline-flex", alignItems: "center" }}
                            >
                                <img
                                    src="https://img.shields.io/badge/GitHub-Repository-181717?logo=github&logoColor=white"
                                    alt="GitHub repository"
                                    style={{ height: "20px" }}
                                />
                            </Link>
                        </Typography>
                    </Card>

                    {/* Architecture Overview */}
                    <Box>
                        <Typography variant="h5" gutterBottom sx={{ fontWeight: 600, color: theme.palette.primary.main }}>
                            System Architecture
                        </Typography>
                        <Divider sx={{ mb: 2 }} />
                        <Typography variant="body1" sx={{ lineHeight: 1.7, mb: 2 }}>
                            The Ground Station application is composed of a frontend, a backend, and a set of worker processes:
                        </Typography>
                        <Stack spacing={1}>
                            <Typography variant="body1">
                                <strong>Frontend:</strong> A responsive single-page application built with React, Redux Toolkit, and Material-UI. It provides an optimal viewing experience across desktop, tablet, and mobile devices, and communicates with the backend using a socket.io connection for real-time updates.
                            </Typography>
                            <Typography variant="body1">
                                <strong>Backend:</strong> A Python application built with FastAPI. It provides a REST API and a socket.io interface for the frontend. It also manages the worker processes.
                            </Typography>
                            <Typography variant="body1">
                                <strong>Workers:</strong> Specialized worker processes handle satellite tracking, hardware control, SDR streaming, and device discovery operations.
                            </Typography>
                        </Stack>
                    </Box>

                    {/* Key Features section */}
                    <Box>
                        <Typography variant="h5" gutterBottom sx={{ fontWeight: 600, color: theme.palette.primary.main }}>
                            Key Features
                        </Typography>
                        <Divider sx={{ mb: 2 }} />

                        <Stack spacing={2}>
                            {featureItems.map((feature, index) => (
                                <Stack key={index} direction="row" spacing={2} alignItems="flex-start">
                                    <Box sx={{ mt: 0.5 }}>{feature.icon}</Box>
                                    <Typography variant="body1">{feature.text}</Typography>
                                </Stack>
                            ))}
                        </Stack>
                    </Box>

                    {/* Planned Features section */}
                    <Box>
                        <Typography variant="h5" gutterBottom sx={{ fontWeight: 600, color: theme.palette.secondary.main }}>
                            Planned Features & Roadmap
                        </Typography>
                        <Divider sx={{ mb: 2 }} />
                        <Typography variant="body2" paragraph sx={{ fontStyle: 'italic', color: 'text.secondary' }}>
                            The following features are planned for future releases:
                        </Typography>

                        <Stack spacing={2}>
                            {plannedFeatures.map((feature, index) => (
                                <Stack key={index} direction="row" spacing={2} alignItems="flex-start">
                                    <Box sx={{ mt: 0.5 }}>{feature.icon}</Box>
                                    <Typography variant="body1">{feature.text}</Typography>
                                </Stack>
                            ))}
                        </Stack>

                    </Box>

                    {/* SDR Device Support */}
                    <Box>
                        <Typography variant="h5" gutterBottom sx={{ fontWeight: 600, color: theme.palette.primary.main }}>
                            SDR Device Support
                        </Typography>
                        <Divider sx={{ mb: 2 }} />
                        <Typography variant="body1" paragraph>
                            Dedicated worker processes provide IQ acquisition, FFT processing, and demodulation support for multiple receiver families:
                        </Typography>
                        <Stack spacing={2}>
                            {sdrSupport.map((device, index) => (
                                <Stack key={index} direction="row" spacing={2} alignItems="center">
                                    <RadioIcon fontSize="small" color="secondary" />
                                    <Typography variant="body1">{device}</Typography>
                                </Stack>
                            ))}
                        </Stack>
                        <Card elevation={1} sx={{ p: 2, mt: 2, backgroundColor: 'rgba(33, 150, 243, 0.05)', border: `1px solid ${theme.palette.info.main}30` }}>
                            <Stack direction="row" spacing={1} alignItems="flex-start">
                                <InfoIcon fontSize="small" color="info" sx={{ mt: 0.5 }} />
                                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                                    <strong>Note:</strong> The current signal demodulator implementations (FM, AM, SSB) were developed with assistance from Claude AI (Anthropic) to handle the complex digital signal processing algorithms. These components are clearly marked in the source code and are licensed under GPL-3.0 like the rest of the project.
                                </Typography>
                            </Stack>
                        </Card>
                    </Box>

                    {/* Third-Party Libraries & Technologies */}
                    <Box>
                        <Typography variant="h5" gutterBottom sx={{ fontWeight: 600, color: theme.palette.primary.main }}>
                            <CodeIcon sx={{ mr: 1, verticalAlign: 'middle' }} />
                            Third-Party Libraries & Technologies
                        </Typography>
                        <Divider sx={{ mb: 2 }} />

                        <Grid container spacing={3}>
                            {/* Backend Technologies */}
                            <Grid size={{ xs: 12, md: 6 }}>
                                <Card elevation={1} sx={{ p: 2, height: '100%' }}>
                                    <Typography variant="h6" gutterBottom sx={{ fontWeight: 600, color: theme.palette.primary.main, display: 'flex', alignItems: 'center' }}>
                                        <StorageIcon sx={{ mr: 1 }} fontSize="small" />
                                        Backend
                                    </Typography>
                                    <Box component="ul" sx={{ pl: 2, m: 0 }}>
                                        {backendTechnologies.map((tech, index) => (
                                            <Box component="li" key={index} sx={{ mb: 1.5, listStyle: 'disc' }}>
                                                <Link 
                                                    href={tech.url} 
                                                    target="_blank" 
                                                    rel="noopener noreferrer"
                                                    sx={{ 
                                                        fontWeight: 'bold',
                                                        color: 'primary.main',
                                                        textDecoration: 'none',
                                                        '&:hover': { textDecoration: 'underline' }
                                                    }}
                                                >
                                                    {tech.name}
                                                </Link>
                                                <Typography variant="body2" component="div" sx={{ mt: 0.5, color: 'text.secondary' }}>
                                                    {tech.description}
                                                </Typography>
                                            </Box>
                                        ))}
                                    </Box>
                                </Card>
                            </Grid>

                            {/* Frontend Technologies */}
                            <Grid size={{ xs: 12, md: 6 }}>
                                <Card elevation={1} sx={{ p: 2, height: '100%' }}>
                                    <Typography variant="h6" gutterBottom sx={{ fontWeight: 600, color: theme.palette.secondary.main, display: 'flex', alignItems: 'center' }}>
                                        <WebIcon sx={{ mr: 1 }} fontSize="small" />
                                        Frontend
                                    </Typography>
                                    <Box component="ul" sx={{ pl: 2, m: 0 }}>
                                        {frontendTechnologies.map((tech, index) => (
                                            <Box component="li" key={index} sx={{ mb: 1.5, listStyle: 'disc' }}>
                                                <Link 
                                                    href={tech.url} 
                                                    target="_blank" 
                                                    rel="noopener noreferrer"
                                                    sx={{ 
                                                        fontWeight: 'bold',
                                                        color: 'secondary.main',
                                                        textDecoration: 'none',
                                                        '&:hover': { textDecoration: 'underline' }
                                                    }}
                                                >
                                                    {tech.name}
                                                </Link>
                                                <Typography variant="body2" component="div" sx={{ mt: 0.5, color: 'text.secondary' }}>
                                                    {tech.description}
                                                </Typography>
                                            </Box>
                                        ))}
                                    </Box>
                                </Card>
                            </Grid>
                        </Grid>
                    </Box>

                    {/* License */}
                    <Box>
                        <Typography variant="h5" gutterBottom sx={{ fontWeight: 600, color: theme.palette.primary.main }}>
                            License
                        </Typography>
                        <Divider sx={{ mb: 2 }} />
                        <Card elevation={1} sx={{ p: 2, backgroundColor: 'rgba(255,255,255,0.05)' }}>
                            <Typography variant="body1">
                                This project is licensed under the <strong>GNU GPL v3</strong>. This ensures that the software remains free and open-source, allowing you to use, modify, and distribute it according to the terms of the license.
                            </Typography>
                        </Card>
                    </Box>
                </Box>
            </CardContent>
        </Paper>
    );
};

export default AboutPage;
