import React, { useState, useEffect } from 'react';
import {
    Container,
    Grid,
    Typography,
    Box,
    Alert,
    CircularProgress,
} from '@mui/material';
import { StatsCards } from '../components/dashboard/StatsCards';
import { PortfolioChart } from '../components/dashboard/PortfolioChart';
import { CarbonOffsetCard } from '../components/dashboard/CarbonOffsetCard';
import { RecentTransactions } from '../components/dashboard/RecentTransactions';
import { DashboardService } from '../services/dashboardService';
import { DashboardStats, PortfolioBreakdown, Transaction, CarbonOffset } from '../types/dashboard';

export const DashboardPage: React.FC = () => {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [stats, setStats] = useState<DashboardStats | null>(null);
    const [portfolio, setPortfolio] = useState<PortfolioBreakdown[]>([]);
    const [carbonOffset, setCarbonOffset] = useState<CarbonOffset | null>(null);
    const [transactions, setTransactions] = useState<Transaction[]>([]);
    const [transactionTotal, setTransactionTotal] = useState(0);
    const [currentPage, setCurrentPage] = useState(1);

    const loadData = async (page: number) => {
        try {
            setLoading(true);
            setError(null);

            const [statsData, portfolioData, carbonData, txData] = await Promise.all([
                DashboardService.getStats(),
                DashboardService.getPortfolioBreakdown(),
                DashboardService.getCarbonOffset(),
                DashboardService.getTransactions(page),
            ]);

            setStats(statsData);
            setPortfolio(portfolioData);
            setCarbonOffset(carbonData);
            setTransactions(txData.transactions);
            setTransactionTotal(txData.total);
            setCurrentPage(txData.page);
        } catch (err) {
            setError('Failed to load dashboard data. Please try again.');
            console.error('Dashboard load error:', err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadData(1);
    }, []);

    const handlePageChange = (page: number) => {
        loadData(page);
    };

    return (
        <Container maxWidth="xl" sx={{ py: 4 }}>
            <Typography variant="h4" component="h1" gutterBottom sx={{ fontWeight: 600 }}>
                📊 Dashboard
            </Typography>
            <Typography variant="body1" color="text.secondary" sx={{ mb: 4 }}>
                Overview of your carbon credit portfolio and impact
            </Typography>

            {error && (
                <Alert severity="error" sx={{ mb: 3 }}>
                    {error}
                </Alert>
            )}

            <StatsCards stats={stats} loading={loading} />

            <Grid container spacing={3} sx={{ mt: 1 }}>
                <Grid item xs={12} md={6}>
                    <PortfolioChart data={portfolio} loading={loading} />
                </Grid>
                <Grid item xs={12} md={6}>
                    <CarbonOffsetCard data={carbonOffset} loading={loading} />
                </Grid>
            </Grid>

            <Box sx={{ mt: 3 }}>
                <RecentTransactions
                    transactions={transactions}
                    total={transactionTotal}
                    page={currentPage}
                    totalPages={Math.ceil(transactionTotal / 10)}
                    loading={loading}
                    onPageChange={handlePageChange}
                />
            </Box>
        </Container>
    );
};
