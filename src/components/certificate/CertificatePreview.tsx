import React, { useRef, forwardRef } from 'react';
import {
    Box,
    Paper,
    Typography,
    Divider,
    Stack,
    useTheme,
} from '@mui/material';
import { QRCodeSVG } from 'qrcode.react';
import { CertificateData } from '../../types/certificate';
import { CertificateService } from '../../services/certificateService';

interface CertificatePreviewProps {
    data: CertificateData;
}

export const CertificatePreview = forwardRef<HTMLDivElement, CertificatePreviewProps>(
    ({ data }, ref) => {
        const theme = useTheme();

        return (
            <Box ref={ref} sx={{ p: 2 }}>
                <Paper
                    elevation={3}
                    sx={{
                        p: 4,
                        maxWidth: 800,
                        mx: 'auto',
                        position: 'relative',
                        overflow: 'hidden',
                        background: 'linear-gradient(135deg, rgba(255,255,255,0.9) 0%, rgba(240,248,255,0.9) 100%)',
                        backdropFilter: 'blur(10px)',
                        border: '1px solid rgba(255,255,255,0.3)',
                        borderRadius: 4,
                    }}
                >
                    {/* Glassmorphism decoration */}
                    <Box
                        sx={{
                            position: 'absolute',
                            top: -100,
                            right: -100,
                            width: 300,
                            height: 300,
                            borderRadius: '50%',
                            background: 'radial-gradient(circle, rgba(46,125,50,0.1) 0%, rgba(46,125,50,0) 70%)',
                            pointerEvents: 'none',
                        }}
                    />
                    <Box
                        sx={{
                            position: 'absolute',
                            bottom: -80,
                            left: -80,
                            width: 250,
                            height: 250,
                            borderRadius: '50%',
                            background: 'radial-gradient(circle, rgba(25,118,210,0.1) 0%, rgba(25,118,210,0) 70%)',
                            pointerEvents: 'none',
                        }}
                    />

                    {/* Certificate Content */}
                    <Box sx={{ position: 'relative', zIndex: 1 }}>
                        {/* Header */}
                        <Box textAlign="center" mb={4}>
                            <Typography
                                variant="h4"
                                component="h1"
                                sx={{
                                    fontWeight: 700,
                                    color: '#1a237e',
                                    letterSpacing: 2,
                                    textTransform: 'uppercase',
                                }}
                            >
                                🌿 Carbon Retirement Certificate
                            </Typography>
                            <Typography variant="subtitle1" color="text.secondary">
                                Verified Carbon Credit Retirement
                            </Typography>
                            <Divider sx={{ my: 2 }} />
                        </Box>

                        {/* Certificate Details */}
                        <Stack spacing={2}>
                            <Box display="flex" justifyContent="space-between" flexWrap="wrap" gap={2}>
                                <Box>
                                    <Typography variant="caption" color="text.secondary">
                                        Serial Number
                                    </Typography>
                                    <Typography variant="body1" sx={{ fontFamily: 'monospace', fontWeight: 600 }}>
                                        {data.serialNumber}
                                    </Typography>
                                </Box>
                                <Box>
                                    <Typography variant="caption" color="text.secondary">
                                        Date of Retirement
                                    </Typography>
                                    <Typography variant="body1">
                                        {CertificateService.formatDate(data.retirementDate)}
                                    </Typography>
                                </Box>
                            </Box>

                            <Box>
                                <Typography variant="caption" color="text.secondary">
                                    Retired By
                                </Typography>
                                <Typography variant="h6" sx={{ fontWeight: 600 }}>
                                    {data.companyName}
                                </Typography>
                                {data.beneficiary && (
                                    <>
                                        <Typography variant="caption" color="text.secondary" sx={{ mt: 1 }}>
                                            Beneficiary
                                        </Typography>
                                        <Typography variant="body1">
                                            {data.beneficiary}
                                        </Typography>
                                    </>
                                )}
                            </Box>

                            <Box>
                                <Typography variant="caption" color="text.secondary">
                                    Amount Retired
                                </Typography>
                                <Typography variant="h5" sx={{ fontWeight: 700, color: '#2E7D32' }}>
                                    {CertificateService.formatNumber(data.amount)} {data.asset}
                                </Typography>
                            </Box>

                            <Box>
                                <Typography variant="caption" color="text.secondary">
                                    Transaction ID
                                </Typography>
                                <Typography variant="body2" sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
                                    {data.transactionId}
                                </Typography>
                            </Box>
                        </Stack>

                        <Divider sx={{ my: 3 }} />

                        {/* Footer with QR Code */}
                        <Box display="flex" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={2}>
                            <Box>
                                <Typography variant="caption" color="text.secondary">
                                    Verify this certificate on-chain
                                </Typography>
                                <Typography variant="body2" color="text.secondary">
                                    Scan the QR code to view the blockchain proof
                                </Typography>
                            </Box>
                            <Box
                                sx={{
                                    p: 1,
                                    bgcolor: 'white',
                                    borderRadius: 2,
                                    boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                                }}
                            >
                                <QRCodeSVG
                                    value={data.blockchainUrl}
                                    size={120}
                                    level="H"
                                    includeMargin
                                />
                            </Box>
                        </Box>

                        {/* Footer Text */}
                        <Box textAlign="center" mt={3}>
                            <Typography variant="caption" color="text.secondary">
                                This certificate is a proof of carbon credit retirement on the Stellar blockchain.
                                Verified by the Carbon Ledger Protocol.
                            </Typography>
                        </Box>
                    </Box>
                </Paper>
            </Box>
        );
    }
);

CertificatePreview.displayName = 'CertificatePreview';
