import React, { useState } from 'react';
import {
    Container,
    Typography,
    Box,
    Alert,
    CircularProgress,
    Paper,
    Divider,
    Chip,
} from '@mui/material';
import { SearchBar } from '../components/audit/SearchBar';
import { Timeline } from '../components/audit/Timeline';
import { EventFilters } from '../components/audit/EventFilters';
import { AuditService } from '../services/auditService';
import { AuditSearchResult, FilterOptions } from '../types/audit';

export const AuditPage: React.FC = () => {
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState<AuditSearchResult | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [filters, setFilters] = useState<FilterOptions>({
        types: ['mint', 'transfer', 'retire'],
    });

    const handleSearch = async (serialNumber: string) => {
        setLoading(true);
        setError(null);
        setResult(null);

        try {
            const data = await AuditService.searchSerial(serialNumber);
            setResult(data);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to search serial number');
        } finally {
            setLoading(false);
        }
    };

    const handleFilterChange = (newFilters: FilterOptions) => {
        setFilters(newFilters);
    };

    const filteredEvents = result?.events.filter(event => 
        filters.types.length === 0 || filters.types.includes(event.type)
    ) || [];

    return (
        <Container maxWidth="lg" sx={{ py: 4 }}>
            <Typography variant="h4" component="h1" gutterBottom sx={{ fontWeight: 600 }}>
                🔍 Audit Trail Explorer
            </Typography>
            <Typography variant="body1" color="text.secondary" sx={{ mb: 4 }}>
                Search by serial number to view the full lifecycle of a carbon credit
            </Typography>

            <SearchBar onSearch={handleSearch} isLoading={loading} />

            {loading && (
                <Box display="flex" justifyContent="center" sx={{ mt: 4 }}>
                    <CircularProgress />
                </Box>
            )}

            {error && (
                <Alert severity="error" sx={{ mt: 3 }}>
                    {error}
                </Alert>
            )}

            {result && !loading && (
                <Box sx={{ mt: 4 }}>
                    <Paper sx={{ p: 3, mb: 3 }}>
                        <Typography variant="h6" gutterBottom>
                            Serial Number: <strong>{result.serialNumber}</strong>
                        </Typography>
                        <Box display="flex" gap={1} flexWrap="wrap">
                            {result.currentOwner && (
                                <Chip
                                    label={`Current Owner: ${result.currentOwner.slice(0, 10)}...`}
                                    color="primary"
                                    variant="outlined"
                                />
                            )}
                            {result.retired && (
                                <Chip
                                    label={`Retired: ${result.retiredAt ? new Date(result.retiredAt).toLocaleDateString() : 'Yes'}`}
                                    color="error"
                                />
                            )}
                            <Chip
                                label={`Total Events: ${result.events.length}`}
                                color="info"
                                variant="outlined"
                            />
                        </Box>
                    </Paper>

                    <Divider sx={{ mb: 3 }} />

                    <EventFilters
                        filters={filters}
                        onFilterChange={handleFilterChange}
                        eventCount={filteredEvents.length}
                    />

                    <Timeline events={filteredEvents} />
                </Box>
            )}
        </Container>
    );
};
