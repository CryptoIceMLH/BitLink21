import * as React from "react";
import {useSocket} from "../common/socket.jsx";
import {useDispatch, useSelector} from "react-redux";
import {Fragment, useCallback, useEffect} from "react";
import { toast } from "../../utils/toast-with-timestamp.jsx";
import Autocomplete from "@mui/material/Autocomplete";
import {CircularProgress, TextField} from "@mui/material";
import { useTranslation } from 'react-i18next';


const SatelliteSearchAutocomplete = React.memo(function SatelliteSearchAutocomplete({onSatelliteSelect}) {
    const {socket} = useSocket();
    const { t } = useTranslation('target');
    const [open, setOpen] = React.useState(false);
    const [options, setOptions] = React.useState([]);
    const [loading, setLoading] = React.useState(false);

    const search = (keyword) => {
        (async () => {
            setLoading(true);
            socket.emit("data_request", "get-satellite-search", keyword, (response) => {
                if (response.success) {
                    setOptions(response.data);
                } else {
                    console.error(response.error);
                    toast.error(`Error searching for satellites: ${response.error}`, {
                        autoClose: 5000,
                    });
                    setOptions([]);
                }
                setLoading(false);
            });
        })();
    };

    const handleOpen = () => {
        setOpen(true);
    };

    const handleClose = () => {
        setOpen(false);
        setOptions([]);
    };

    const handleInputChange = (event, newInputValue) => {
        if (newInputValue.length > 2) {
            search(newInputValue);
        }
    };

    const handleOptionSelect = (event, selectedSatellite) => {
        if (selectedSatellite !== null) {
            selectedSatellite['id'] = selectedSatellite['norad_id'];
            onSatelliteSelect(selectedSatellite);
        }
    }

    return (
        <Autocomplete
            size="small"
            sx={{ minWidth: 200, margin: 0 }}
            open={open}
            fullWidth={true}
            onOpen={handleOpen}
            onClose={handleClose}
            onInputChange={handleInputChange}
            onChange={handleOptionSelect}
            isOptionEqualToValue={(option, value) => option.name === value.name}
            getOptionLabel={(option) => {
                return `${option['norad_id']} - ${option['name']}`;
            }}
            options={options}
            loading={loading}
            renderInput={(params) => (
                <TextField
                    size="small"
                    fullWidth={true}
                    {...params}
                    label={t('satellite_search.search_label')}
                    slotProps={{
                        input: {
                            ...params.InputProps,
                            endAdornment: (
                                <Fragment>
                                    {loading ? <CircularProgress color="inherit" size={20} /> : null}
                                    {params.InputProps.endAdornment}
                                </Fragment>
                            ),
                        },
                    }}
                />
            )}
        />
    );
});

export default SatelliteSearchAutocomplete;