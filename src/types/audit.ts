export interface AuditEvent {
    id: string;
    serialNumber: string;
    type: 'mint' | 'transfer' | 'retire';
    date: string;
    parties: {
        from?: string;
        to?: string;
        operator?: string;
    };
    transactionId: string;
    amount: number;
    asset?: string;
    details?: Record<string, any>;
}

export interface AuditSearchResult {
    serialNumber: string;
    events: AuditEvent[];
    currentOwner?: string;
    retired?: boolean;
    retiredAt?: string;
}

export interface FilterOptions {
    types: ('mint' | 'transfer' | 'retire')[];
    dateRange?: {
        start: string;
        end: string;
    };
}
