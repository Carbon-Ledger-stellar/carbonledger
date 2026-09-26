import React, { useState, useRef } from 'react';
import {
    Dialog,
    DialogContent,
    DialogActions,
    Button,
    Box,
    CircularProgress,
    Alert,
    IconButton,
} from '@mui/material';
import { Close as CloseIcon } from '@mui/icons-material';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import { CertificateForm } from './CertificateForm';
import { CertificatePreview } from './CertificatePreview';
import { CertificateData, CertificateFormData } from '../../types/certificate';
import { CertificateService } from '../../services/certificateService';

interface CertificateModalProps {
    open: boolean;
    onClose: () => void;
    serialNumber: string;
    amount: number;
    asset: string;
    retirementDate: string;
    transactionId: string;
    onDownload?: () => void;
}

export const CertificateModal: React.FC<CertificateModalProps> = ({
    open,
    onClose,
    serialNumber,
    amount,
    asset,
    retirementDate,
    transactionId,
    onDownload,
}) => {
    const [step, setStep] = useState<'form' | 'preview'>('form');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [certificateData, setCertificateData] = useState<CertificateData | null>(null);
    const previewRef = useRef<HTMLDivElement>(null);

    const handleFormSubmit = (formData: CertificateFormData) => {
        const blockchainUrl = CertificateService.getBlockchainUrl(transactionId);
        
        const data: CertificateData = {
            serialNumber,
            companyName: formData.companyName,
            beneficiary: formData.beneficiary || undefined,
            amount,
            asset,
            retirementDate,
            transactionId,
            blockchainUrl,
        };

        setCertificateData(data);
        setStep('preview');
    };

    const handleDownloadPDF = async () => {
        if (!previewRef.current || !certificateData) return;

        setLoading(true);
        setError(null);

        try {
            const canvas = await html2canvas(previewRef.current, {
                scale: 2,
                useCORS: true,
                logging: false,
                backgroundColor: '#ffffff',
            });

            const imgData = canvas.toDataURL('image/png');
            const pdf = new jsPDF({
                orientation: 'portrait',
                unit: 'px',
                format: [canvas.width * 0.5, canvas.height * 0.5],
            });

            const pdfWidth = pdf.internal.pageSize.getWidth();
            const pdfHeight = pdf.internal.pageSize.getHeight();

            pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
            
            const fileName = CertificateService.generateFileName(certificateData);
            pdf.save(fileName);

            if (onDownload) {
                onDownload();
            }

            // Close modal after download
            setTimeout(() => {
                onClose();
                setStep('form');
                setCertificateData(null);
            }, 500);
        } catch (err) {
            setError('Failed to generate PDF. Please try again.');
            console.error('PDF generation error:', err);
        } finally {
            setLoading(false);
        }
    };

    const handleBackToForm = () => {
        setStep('form');
        setCertificateData(null);
    };

    const handleClose = () => {
        onClose();
        // Reset state after a delay
        setTimeout(() => {
            setStep('form');
            setCertificateData(null);
            setError(null);
        }, 300);
    };

    return (
        <Dialog
            open={open}
            onClose={handleClose}
            maxWidth="lg"
            fullWidth
            PaperProps={{
                sx: {
                    borderRadius: 3,
                    maxHeight: '90vh',
                },
            }}
        >
            <DialogContent sx={{ p: 0 }}>
                {step === 'form' && (
                    <CertificateForm
                        onSubmit={handleFormSubmit}
                        onClose={handleClose}
                        isLoading={loading}
                        initialData={{
                            companyName: localStorage.getItem('lastCompanyName') || '',
                        }}
                    />
                )}

                {step === 'preview' && certificateData && (
                    <Box>
                        <Box
                            display="flex"
                            justifyContent="space-between"
                            alignItems="center"
                            sx={{ p: 2, borderBottom: 1, borderColor: 'divider' }}
                        >
                            <Box display="flex" alignItems="center" gap={1}>
                                <Button
                                    variant="text"
                                    onClick={handleBackToForm}
                                    disabled={loading}
                                >
                                    ← Back
                                </Button>
                            </Box>
                            <IconButton onClick={handleClose} size="small" disabled={loading}>
                                <CloseIcon />
                            </IconButton>
                        </Box>

                        <CertificatePreview ref={previewRef} data={certificateData} />

                        {error && (
                            <Alert severity="error" sx={{ m: 2 }}>
                                {error}
                            </Alert>
                        )}

                        <Box
                            display="flex"
                            justifyContent="flex-end"
                            sx={{ p: 2, borderTop: 1, borderColor: 'divider', gap: 2 }}
                        >
                            <Button
                                variant="outlined"
                                onClick={handleBackToForm}
                                disabled={loading}
                            >
                                Edit Details
                            </Button>
                            <Button
                                variant="contained"
                                onClick={handleDownloadPDF}
                                disabled={loading}
                                startIcon={loading ? <CircularProgress size={20} /> : null}
                            >
                                {loading ? 'Generating PDF...' : 'Download PDF'}
                            </Button>
                        </Box>
                    </Box>
                )}
            </DialogContent>
        </Dialog>
    );
};
