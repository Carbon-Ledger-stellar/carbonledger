export interface Credit {
    id: string;
    serialNumber: string;
    amount: number;
    asset: string;
    status: 'owned' | 'pending' | 'retired';
    value: number;
    purchasePrice?: number;
    acquisitionDate: string;
    retirementDate?: string;
    projectType: string;
    vintage: number;
}

export interface DashboardStats {
    totalCredits: number;
    totalValue: number;
    retiredCredits: number;
    pendingCredits: number;
    carbonOffset: number; // in tonnes
    averagePrice: number;
}

export interface Transaction {
    id: string;
    type: 'buy' | 'sell' | 'retire' | 'transfer';
    amount: number;
    price: number;
    total: number;
    asset: string;
    date: string;
    counterparty?: string;
    status: 'completed' | 'pending' | 'failed';
}

export interface PortfolioBreakdown {
    projectType: string;
    value: number;
    percentage: number;
    color: string;
}

export interface CarbonOffset {
    tonnes: number;
    equivalent: {
        trees: number;
        cars: number;
        flights: number;
        homes: number;
    };
}
