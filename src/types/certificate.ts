export interface CertificateData {
    serialNumber: string;
    companyName: string;
    beneficiary?: string;
    amount: number;
    asset: string;
    retirementDate: string;
    transactionId: string;
    blockchainUrl: string;
}

export interface CertificateFormData {
    companyName: string;
    beneficiary: string;
}
