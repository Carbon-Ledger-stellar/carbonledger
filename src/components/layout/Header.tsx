import React from 'react';
import {
    AppBar,
    Toolbar,
    Typography,
    Box,
    Container,
    Button,
    useTheme,
} from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { WalletConnectButton } from '../wallet/WalletConnectButton';
import { useWallet } from '../../context/WalletContext';

export const Header: React.FC = () => {
    const theme = useTheme();
    const { wallet } = useWallet();

    return (
        <AppBar position="sticky" color="default" elevation={1}>
            <Container maxWidth="xl">
                <Toolbar sx={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}>
                    <Box display="flex" alignItems="center" gap={1}>
                        <Typography
                            variant="h6"
                            component={RouterLink}
                            to="/"
                            sx={{
                                textDecoration: 'none',
                                color: 'inherit',
                                fontWeight: 700,
                                '&:hover': { opacity: 0.8 },
                            }}
                        >
                            🌿 Carbon Ledger
                        </Typography>
                        {wallet.isConnected && (
                            <Typography
                                variant="caption"
                                sx={{
                                    bgcolor: theme.palette.success.light,
                                    color: theme.palette.success.dark,
                                    px: 1,
                                    py: 0.5,
                                    borderRadius: 1,
                                }}
                            >
                                Connected
                            </Typography>
                        )}
                    </Box>

                    <Box display="flex" alignItems="center" gap={2} sx={{ flexWrap: 'wrap' }}>
                        <Button
                            component={RouterLink}
                            to="/dashboard"
                            color="inherit"
                            sx={{ textTransform: 'none' }}
                        >
                            Dashboard
                        </Button>
                        <Button
                            component={RouterLink}
                            to="/audit"
                            color="inherit"
                            sx={{ textTransform: 'none' }}
                        >
                            Audit
                        </Button>
                        <WalletConnectButton />
                    </Box>
                </Toolbar>
            </Container>
        </AppBar>
    );
};
