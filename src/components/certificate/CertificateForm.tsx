import React, { useState } from 'react';
import {
    Box,
    TextField,
    Button,
    Stack,
    Paper,
    Typography,
    IconButton,
    InputAdornment,
} from '@mui/material';
import {
    Download as DownloadIcon,
    Close as CloseIcon,
} from '@mui/icons-material';
import { CertificateFormData } from '../../types/certificate';

interface CertificateFormProps {
    onSubmit: (data: CertificateFormData) => void;
    onClose: () => void;
    isLoading?: boolean;
    initialData?: Partial<CertificateFormData>;
}

export const CertificateForm: React.FC<CertificateFormProps> = ({
    onSubmit,
    onClose,
    isLoading = false,
    initialData = {},
}) => {
    const [formData, setFormData] = useState<CertificateFormData>({
        companyName: initialData.companyName || '',
        beneficiary: initialData.beneficiary || '',
    });

    const handleChange = (field: keyof CertificateFormData) => (
        e: React.ChangeEvent<HTMLInputElement>
    ) => {
        setFormData((prev) => ({
            ...prev,
            [field]: e.target.value,
        }));
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (formData.companyName.trim()) {
            onSubmit(formData);
        }
    };

    return (
        <Paper elevation={3} sx={{ p: 4, maxWidth: 500, mx: 'auto' }}>
            <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
                <Typography variant="h6" sx={{ fontWeight: 600 }}>
                    📄 Retirement Certificate
                </Typography>
                <IconButton onClick={onClose} size="small">
                    <CloseIcon />
                </IconButton>
            </Box>

            <Typography variant="body2" color="text.secondary" mb={3}>
                Enter the details for your retirement certificate. The certificate will be generated
                with your information and a QR code linking to the blockchain proof.
            </Typography>

            <form onSubmit={handleSubmit}>
                <Stack spacing={3}>
                    <TextField
                        label="Company Name *"
                        value={formData.companyName}
                        onChange={handleChange('companyName')}
                        required
                        fullWidth
                        placeholder="Enter your company name"
                        disabled={isLoading}
                    />

                    <TextField
                        label="Beneficiary (Optional)"
                        value={formData.beneficiary}
                        onChange={handleChange('beneficiary')}
                        fullWidth
                        placeholder="Enter beneficiary name"
                        disabled={isLoading}
                        helperText="If applicable, the person or organization receiving credit"
                    />

                    <Box display="flex" gap={2}>
                        <Button
                            variant="outlined"
                            onClick={onClose}
                            fullWidth
                            disabled={isLoading}
                        >
                            Cancel
                        </Button>
                        <Button
                            type="submit"
                            variant="contained"
                            fullWidth
                            disabled={!formData.companyName.trim() || isLoading}
                            startIcon={<DownloadIcon />}
                        >
                            {isLoading ? 'Generating...' : 'Generate Certificate'}
                        </Button>
                    </Box>
                </Stack>
            </form>
        </Paper>
    );
};
