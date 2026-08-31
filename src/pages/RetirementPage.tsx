import React, { useState } from 'react';
import {
    Container,
    Typography,
    Box,
    Card,
    CardContent,
    Button,
    Chip,
    Divider,
    Paper,
    Stack,
} from '@mui/material';
import {
    CheckCircle as CheckIcon,
    Download as DownloadIcon,
} from '@mui/icons-material';
import { CertificateModal } from '../components/certificate/CertificateModal';

// Mock retirement data
const mockRetirement = {
    serialNumber: 'CARBON-2024-001',
    amount: 1000,
    asset: 'CARBON',
    retirementDate: '2024-03-10T09:15:00Z',
    transactionId: '0x7890abcdef1234567890abcdef1234567890abcdef',
};

export const RetirementPage: React.FC = () => {
    const [modalOpen, setModalOpen] = useState(false);

    const handleCertificateClick = () => {
        setModalOpen(true);
    };

    return (
        <Container maxWidth="md" sx={{ py: 4 }}>
            <Paper elevation={2} sx={{ p: 4 }}>
                <Box textAlign="center" mb={4}>
                    <CheckIcon sx={{ fontSize: 64, color: '#2E7D32' }} />
                    <Typography variant="h4" gutterBottom sx={{ fontWeight: 600 }}>
                        🎉 Retirement Successful!
                    </Typography>
                    <Typography variant="body1" color="text.secondary">
                        Your carbon credits have been permanently retired.
                    </Typography>
                </Box>

                <Divider sx={{ mb: 4 }} />

                <Typography variant="h6" gutterBottom>
                    Retirement Details
                </Typography>

                <Stack spacing={2} sx={{ mb: 4 }}>
                    <Box display="flex" justifyContent="space-between" flexWrap="wrap" gap={1}>
                        <Typography variant="body2" color="text.secondary">Serial Number:</Typography>
                        <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                            {mockRetirement.serialNumber}
                        </Typography>
                    </Box>
                    <Box display="flex" justifyContent="space-between" flexWrap="wrap" gap={1}>
                        <Typography variant="body2" color="text.secondary">Amount:</Typography>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                            {mockRetirement.amount} {mockRetirement.asset}
                        </Typography>
                    </Box>
                    <Box display="flex" justifyContent="space-between" flexWrap="wrap" gap={1}>
                        <Typography variant="body2" color="text.secondary">Date:</Typography>
                        <Typography variant="body2">
                            {new Date(mockRetirement.retirementDate).toLocaleString('en-US', {
                                year: 'numeric',
                                month: 'long',
                                day: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                            })}
                        </Typography>
                    </Box>
                    <Box display="flex" justifyContent="space-between" flexWrap="wrap" gap={1}>
                        <Typography variant="body2" color="text.secondary">Transaction ID:</Typography>
                        <Typography variant="body2" sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
                            {mockRetirement.transactionId.slice(0, 30)}...
                        </Typography>
                    </Box>
                </Stack>

                <Divider sx={{ mb: 4 }} />

                <Box textAlign="center">
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                        Download your retirement certificate as a PDF with a verifiable QR code.
                    </Typography>
                    <Button
                        variant="contained"
                        size="large"
                        startIcon={<DownloadIcon />}
                        onClick={handleCertificateClick}
                        sx={{
                            px: 4,
                            py: 1.5,
                            borderRadius: 2,
                            textTransform: 'none',
                        }}
                    >
                        Get Your Certificate
                    </Button>
                </Box>
            </Paper>

            <CertificateModal
                open={modalOpen}
                onClose={() => setModalOpen(false)}
                serialNumber={mockRetirement.serialNumber}
                amount={mockRetirement.amount}
                asset={mockRetirement.asset}
                retirementDate={mockRetirement.retirementDate}
                transactionId={mockRetirement.transactionId}
                onDownload={() => {
                    console.log('Certificate downloaded');
                }}
            />
        </Container>
    );
};
