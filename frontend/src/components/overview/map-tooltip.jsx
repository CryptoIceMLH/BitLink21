
import React, { useState, useEffect, useRef } from 'react';
import { Marker } from 'react-leaflet';
import { Button, Box, IconButton } from '@mui/material';
import { ThemedLeafletTooltip } from "../common/common.jsx";
import { styled } from '@mui/material/styles';
import { Tooltip as LeafletTooltip } from 'react-leaflet';
import TrackChangesIcon from '@mui/icons-material/TrackChanges';
import InfoIcon from '@mui/icons-material/Info';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

// Styled tooltip specifically for tracked satellites
const TrackedSatelliteTooltip = styled(LeafletTooltip)(({ theme }) => ({
    color: theme.palette.text.primary,
    backgroundColor: theme.palette.error.dark,
    borderRadius: theme.shape.borderRadius,
    borderColor: theme.palette.error.main,
    zIndex: 1000,
    '&::before': {
        borderBottomColor: `${theme.palette.error.main} !important`,
    },
}));

const SatelliteMarker = ({
                             satellite,
                             position,
                             altitude,
                             velocity,
                             trackingSatelliteId,
                             selectedSatelliteId,
                             markerEventHandlers,
                             satelliteIcon,
                             opacity = 1,
                             handleSetTrackingOnBackend,
                         }) => {
    const navigate = useNavigate();
    const { t } = useTranslation('overview');

    // Local state for the disabled property
    const [isDisabled, setIsDisabled] = useState(trackingSatelliteId === satellite.norad_id);

    // Update local state whenever the dependencies change
    useEffect(() => {
        setIsDisabled(trackingSatelliteId === satellite.norad_id);
    }, [trackingSatelliteId, satellite.norad_id]);

    const isTracking = trackingSatelliteId === satellite.norad_id;
    const isSelected = selectedSatelliteId === satellite.norad_id;

    // Choose which tooltip component to use
    const TooltipComponent = isTracking ? TrackedSatelliteTooltip : ThemedLeafletTooltip;

    const handleSetTarget = (e) => {
        e.stopPropagation();
        if (handleSetTrackingOnBackend) {
            handleSetTrackingOnBackend(satellite.norad_id);
        }
    };

    const handleNavigateToSatellite = (e) => {
        e.stopPropagation();
        navigate(`/satellite/${satellite.norad_id}`);
    };

    return (
        <Marker
            key={`marker-${satellite.norad_id}-${trackingSatelliteId === satellite}`}
            position={position}
            icon={satelliteIcon}
            eventHandlers={markerEventHandlers}
            opacity={opacity}
        >
            <TooltipComponent
                direction="bottom"
                offset={[0, 15]}
                permanent={true}
                className={"tooltip-satellite"}
                interactive={true}
            >
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                    <strong>
                        <span style={{}}>{isTracking && '◎ '}</span>
                        {satellite.name} - {parseInt(altitude) + " km, " + velocity.toFixed(2) + " km/s"}
                    </strong>
                    {isSelected && !isTracking && (
                        <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
                            <Button
                                size="small"
                                variant="contained"
                                color="primary"
                                startIcon={<TrackChangesIcon />}
                                onClick={handleSetTarget}
                                sx={{
                                    fontSize: '0.7rem',
                                    py: 0.3,
                                    px: 1,
                                    flex: 1,
                                }}
                            >
                                {t('map_target.set_target')}
                            </Button>
                            <IconButton
                                onClick={handleNavigateToSatellite}
                                sx={{
                                    backgroundColor: 'action.hover',
                                    '&:hover': {
                                        backgroundColor: 'action.selected',
                                    },
                                    padding: '4px',
                                }}
                                size="small"
                                title={t('map_target.view_details')}
                            >
                                <InfoIcon fontSize="small" />
                            </IconButton>
                        </Box>
                    )}
                </Box>
            </TooltipComponent>
        </Marker>
    );
};

export default React.memo(SatelliteMarker);