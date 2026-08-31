import { CertificateData } from '../types/certificate';

export class CertificateService {
    static generateFileName(data: CertificateData): string {
        const date = new Date(data.retirementDate);
        const dateStr = date.toISOString().split('T')[0];
        return `retirement_cert_${data.serialNumber}_${dateStr}.pdf`;
    }

    static getBlockchainUrl(txId: string): string {
        const network = process.env.REACT_APP_STELLAR_NETWORK || 'testnet';
        const baseUrl = network === 'mainnet' 
            ? 'https://stellar.expert/explorer/public/tx'
            : 'https://stellar.expert/explorer/testnet/tx';
        return `${baseUrl}/${txId}`;
    }

    static formatDate(date: string): string {
        return new Date(date).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
        });
    }

    static formatNumber(amount: number): string {
        return amount.toLocaleString('en-US', {
            minimumFractionDigits: 0,
            maximumFractionDigits: 2,
        });
    }
}
