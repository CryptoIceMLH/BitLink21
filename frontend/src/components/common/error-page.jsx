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


import React from 'react';
import { Link, useRouteError } from 'react-router-dom';

import {Container, Typography, Button, Box} from '@mui/material';

const ErrorPage = () => {
    const error = useRouteError();
    const [showStack, setShowStack] = React.useState(false);

    return (
        <Container
            maxWidth="lg"
            style={{
                display: 'flex',
                maxHeight: '100vh',
                flexDirection: 'column',
                justifyContent: 'center',
                alignItems: 'center',
                textAlign: 'center'
            }}
        >
            <Box>
                <Typography variant="h3" color="error" style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
                    <span>Error {error?.status || 'Unknown'}</span>
                    <span role="img" aria-label="error-icon">❌</span>
                </Typography>
                <Typography variant="h5" color="textSecondary" gutterBottom>
                    {error?.statusText || 'Something went wrong'}
                </Typography>
                <Typography variant="body1" color="textSecondary" style={{marginBottom: '16px'}}>
                    {error?.message || 'An unexpected error has occurred, please try again later.'}
                </Typography>
                <Box>
                    <Button
                        variant="text"
                        color="primary"
                        size="small"
                        onClick={() => setShowStack(prev => !prev)}
                        style={{textTransform: 'none', marginBottom: '8px'}}
                    >
                        {showStack ? 'Hide Stack Trace' : 'Show Stack Trace'}
                    </Button>
                    {showStack && (
                        <Box
                            style={{
                                overflow: 'auto',
                                fontSize: '12px',
                                marginTop: '16px',
                                whiteSpace: 'pre-wrap',
                                textAlign: 'left',
                                width: '100%',
                                height: '300px',
                            }}
                        >
                            {error?.stack || 'No stack trace available.'}
                        </Box>
                    )}
                </Box>
            </Box>
            <Button
                variant="contained"
                color="primary"
                size="large"
                onClick={() => window.location.href = '/feed'}
            >
                Back to Home
            </Button>
        </Container>
    );
};

export default ErrorPage;
