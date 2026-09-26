import React, { useState } from 'react';
import {
    Button,
    Menu,
    MenuItem,
    Box,
    Typography,
    Chip,
    CircularProgress,
    IconButton,
    Tooltip,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogContentText,
    DialogActions,
    Link,
} from '@mui/material';
import {
    AccountBalanceWallet as WalletIcon,
    PowerSettingsNew as DisconnectIcon,
    CheckCircle as ConnectedIcon,
    Error as ErrorIcon,
    OpenInNew as OpenIcon,
} from '@mui/icons-material';
import { useFreighter } from '../../hooks/useFreighter';

export const WalletConnectButton: React.FC = () => {
    const {
        status,
        wallet,
        error,
        isFreighterInstalled,
        connect,
        disconnect,
        abbreviatedPublicKey,
    } = useFreighter();

    const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
    const [showErrorDialog, setShowErrorDialog] = useState(false);

    const handleMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
        setAnchorEl(event.currentTarget);
    };

    const handleMenuClose = () => {
        setAnchorEl(null);
    };

    const handleConnect = async () => {
        await connect();
        if (error) {
            setShowErrorDialog(true);
        }
        handleMenuClose();
    };

    const handleDisconnect = () => {
        disconnect();
        handleMenuClose();
    };

    const getStatusColor = () => {
        switch (status) {
            case 'connected':
                return 'success';
            case 'connecting':
                return 'warning';
            case 'error':
                return 'error';
            default:
                return 'default';
        }
    };

    const getStatusLabel = () => {
        switch (status) {
            case 'connected':
                return 'Connected';
            case 'connecting':
                return 'Connecting...';
            case 'error':
                return 'Error';
            case 'disconnected':
                return 'Disconnected';
            default:
                return 'Not Connected';
        }
    };

    if (!isFreighterInstalled) {
        return (
            <Tooltip title="Freighter wallet not installed">
                <Button
                    variant="outlined"
                    color="warning"
                    startIcon={<WalletIcon />}
                    onClick={() => window.open('https://www.freighter.app/', '_blank')}
                >
                    Install Freighter
                </Button>
            </Tooltip>
        );
    }

    if (status === 'connected' && wallet.publicKey) {
        return (
            <>
                <Button
                    variant="contained"
                    color="success"
                    startIcon={<ConnectedIcon />}
                    endIcon={<Chip label="✅" size="small" />}
                    onClick={handleMenuOpen}
                    sx={{ textTransform: 'none' }}
                >
                    <Box display="flex" alignItems="center" gap={1}>
                        <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                            {abbreviatedPublicKey}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                            ({wallet.network})
                        </Typography>
                    </Box>
                </Button>

                <Menu
                    anchorEl={anchorEl}
                    open={Boolean(anchorEl)}
                    onClose={handleMenuClose}
                    anchorOrigin={{
                        vertical: 'bottom',
                        horizontal: 'right',
                    }}
                    transformOrigin={{
                        vertical: 'top',
                        horizontal: 'right',
                    }}
                >
                    <MenuItem sx={{ pointerEvents: 'none' }}>
                        <Box>
                            <Typography variant="caption" color="text.secondary">
                                Connected to Freighter
                            </Typography>
                            <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                                {wallet.publicKey}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                                Network: {wallet.network}
                            </Typography>
                        </Box>
                    </MenuItem>
                    <MenuItem
                        onClick={() => {
                            window.open(`https://stellar.expert/explorer/${wallet.network}/account/${wallet.publicKey}`, '_blank');
                            handleMenuClose();
                        }}
                    >
                        <OpenIcon fontSize="small" sx={{ mr: 1 }} />
                        View on Explorer
                    </MenuItem>
                    <MenuItem onClick={handleDisconnect} sx={{ color: 'error.main' }}>
                        <DisconnectIcon fontSize="small" sx={{ mr: 1 }} />
                        Disconnect
                    </MenuItem>
                </Menu>
            </>
        );
    }

    return (
        <>
            <Button
                variant="contained"
                color={status === 'error' ? 'error' : 'primary'}
                startIcon={
                    status === 'connecting' ? (
                        <CircularProgress size={20} color="inherit" />
                    ) : status === 'error' ? (
                        <ErrorIcon />
                    ) : (
                        <WalletIcon />
                    )
                }
                onClick={handleConnect}
                disabled={status === 'connecting'}
                sx={{ textTransform: 'none' }}
            >
                {status === 'error' ? 'Retry Connection' : 'Connect Wallet'}
            </Button>

            <Dialog open={showErrorDialog} onClose={() => setShowErrorDialog(false)}>
                <DialogTitle>Connection Error</DialogTitle>
                <DialogContent>
                    <DialogContentText>
                        {error?.message || 'Failed to connect to Freighter wallet.'}
                        {error?.code === 'FREIGHTER_NOT_INSTALLED' && (
                            <Box mt={2}>
                                <Link
                                    href="https://www.freighter.app/"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                >
                                    Install Freighter Wallet →
                                </Link>
                            </Box>
                        )}
                    </DialogContentText>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setShowErrorDialog(false)}>Close</Button>
                    {error?.code !== 'FREIGHTER_NOT_INSTALLED' && (
                        <Button onClick={() => { connect(); setShowErrorDialog(false); }}>
                            Try Again
                        </Button>
                    )}
                </DialogActions>
            </Dialog>
        </>
    );
};
