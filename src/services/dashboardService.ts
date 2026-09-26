import { Credit, DashboardStats, Transaction, PortfolioBreakdown, CarbonOffset } from '../types/dashboard';

// Mock data for development
const mockCredits: Credit[] = [
    {
        id: '1',
        serialNumber: 'CARBON-2024-001',
        amount: 1000,
        asset: 'CARBON',
        status: 'owned',
        value: 25000,
        purchasePrice: 20,
        acquisitionDate: '2024-01-15',
        projectType: 'Forestry',
        vintage: 2024,
    },
    {
        id: '2',
        serialNumber: 'CARBON-2024-002',
        amount: 500,
        asset: 'CARBON',
        status: 'owned',
        value: 12500,
        purchasePrice: 22,
        acquisitionDate: '2024-02-01',
        projectType: 'Renewable Energy',
        vintage: 2024,
    },
    {
        id: '3',
        serialNumber: 'CARBON-2023-015',
        amount: 2000,
        asset: 'CARBON',
        status: 'retired',
        value: 0,
        purchasePrice: 18,
        acquisitionDate: '2023-11-10',
        retirementDate: '2024-03-10',
        projectType: 'Forestry',
        vintage: 2023,
    },
    {
        id: '4',
        serialNumber: 'CARBON-2024-003',
        amount: 300,
        asset: 'CARBON',
        status: 'pending',
        value: 7500,
        purchasePrice: 25,
        acquisitionDate: '2024-02-15',
        projectType: 'Blue Carbon',
        vintage: 2024,
    },
];

const mockTransactions: Transaction[] = [
    {
        id: '1',
        type: 'buy',
        amount: 1000,
        price: 20,
        total: 20000,
        asset: 'CARBON',
        date: '2024-01-15T10:30:00Z',
        counterparty: '0x1234...5678',
        status: 'completed',
    },
    {
        id: '2',
        type: 'buy',
        amount: 500,
        price: 22,
        total: 11000,
        asset: 'CARBON',
        date: '2024-02-01T14:20:00Z',
        counterparty: '0x8765...4321',
        status: 'completed',
    },
    {
        id: '3',
        type: 'retire',
        amount: 2000,
        price: 0,
        total: 0,
        asset: 'CARBON',
        date: '2024-03-10T09:15:00Z',
        counterparty: 'Carbon Ledger Protocol',
        status: 'completed',
    },
    {
        id: '4',
        type: 'buy',
        amount: 300,
        price: 25,
        total: 7500,
        asset: 'CARBON',
        date: '2024-02-15T11:45:00Z',
        counterparty: '0x9876...5432',
        status: 'pending',
    },
];

const projectTypeColors: Record<string, string> = {
    'Forestry': '#2E7D32',
    'Renewable Energy': '#1976D2',
    'Blue Carbon': '#00BCD4',
    'Agriculture': '#FF9800',
    'Waste Management': '#9C27B0',
};

export class DashboardService {
    static async getCredits(): Promise<Credit[]> {
        // In production, this would call the API
        return mockCredits;
    }

    static async getStats(): Promise<DashboardStats> {
        const credits = await this.getCredits();
        const owned = credits.filter(c => c.status === 'owned');
        const retired = credits.filter(c => c.status === 'retired');
        const pending = credits.filter(c => c.status === 'pending');

        const totalValue = owned.reduce((sum, c) => sum + c.value, 0);
        const totalCredits = owned.reduce((sum, c) => sum + c.amount, 0);
        const retiredCredits = retired.reduce((sum, c) => sum + c.amount, 0);

        // Calculate carbon offset (1 credit = 1 tonne CO2)
        const carbonOffset = retiredCredits;

        return {
            totalCredits,
            totalValue,
            retiredCredits,
            pendingCredits: pending.reduce((sum, c) => sum + c.amount, 0),
            carbonOffset,
            averagePrice: owned.length > 0 
                ? totalValue / totalCredits 
                : 0,
        };
    }

    static async getTransactions(page: number = 1, limit: number = 10): Promise<{
        transactions: Transaction[];
        total: number;
        page: number;
        totalPages: number;
    }> {
        const start = (page - 1) * limit;
        const end = start + limit;
        const paginated = mockTransactions.slice(start, end);
        
        return {
            transactions: paginated,
            total: mockTransactions.length,
            page,
            totalPages: Math.ceil(mockTransactions.length / limit),
        };
    }

    static async getPortfolioBreakdown(): Promise<PortfolioBreakdown[]> {
        const credits = await this.getCredits();
        const owned = credits.filter(c => c.status === 'owned');
        
        const breakdown: Record<string, { value: number; percentage: number }> = {};
        const totalValue = owned.reduce((sum, c) => sum + c.value, 0);

        for (const credit of owned) {
            if (!breakdown[credit.projectType]) {
                breakdown[credit.projectType] = { value: 0, percentage: 0 };
            }
            breakdown[credit.projectType].value += credit.value;
        }

        return Object.entries(breakdown).map(([projectType, data]) => ({
            projectType,
            value: data.value,
            percentage: totalValue > 0 ? (data.value / totalValue) * 100 : 0,
            color: projectTypeColors[projectType] || '#999',
        }));
    }

    static async getCarbonOffset(): Promise<CarbonOffset> {
        const stats = await this.getStats();
        const tonnes = stats.carbonOffset;

        // Equivalent calculations
        // 1 tonne CO2 ≈ 45 trees (over 30 years)
        // 1 tonne CO2 ≈ 0.4 cars (annual emissions)
        // 1 tonne CO2 ≈ 2.5 flights (NY-London)
        // 1 tonne CO2 ≈ 0.12 homes (annual energy)

        return {
            tonnes,
            equivalent: {
                trees: Math.round(tonnes * 45),
                cars: Math.round(tonnes * 0.4),
                flights: Math.round(tonnes * 2.5),
                homes: Math.round(tonnes * 0.12),
            },
        };
    }

    static async getMarketPrice(): Promise<number> {
        // In production, this would fetch from an oracle
        return 24.50;
    }
}
