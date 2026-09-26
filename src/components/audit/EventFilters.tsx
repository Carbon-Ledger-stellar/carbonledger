import React from 'react';
import {
    Box,
    ToggleButton,
    ToggleButtonGroup,
    Typography,
    Chip,
} from '@mui/material';
import { FilterOptions } from '../../types/audit';

interface EventFiltersProps {
    filters: FilterOptions;
    onFilterChange: (filters: FilterOptions) => void;
    eventCount: number;
}

export const EventFilters: React.FC<EventFiltersProps> = ({
    filters,
    onFilterChange,
    eventCount,
}) => {
    const handleTypeChange = (
        _: React.MouseEvent<HTMLElement>,
        newTypes: ('mint' | 'transfer' | 'retire')[],
    ) => {
        if (newTypes !== null) {
            onFilterChange({ ...filters, types: newTypes });
        }
    };

    return (
        <Box sx={{ mb: 3 }}>
            <Box display="flex" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={2}>
                <Box display="flex" alignItems="center" gap={2}>
                    <Typography variant="subtitle2" color="text.secondary">
                        Filter by:
                    </Typography>
                    <ToggleButtonGroup
                        value={filters.types}
                        onChange={handleTypeChange}
                        aria-label="event type filter"
                        size="small"
                    >
                        <ToggleButton value="mint">
                            Mint
                        </ToggleButton>
                        <ToggleButton value="transfer">
                            Transfer
                        </ToggleButton>
                        <ToggleButton value="retire">
                            Retire
                        </ToggleButton>
                    </ToggleButtonGroup>
                </Box>
                <Chip
                    label={`${eventCount} event${eventCount !== 1 ? 's' : ''}`}
                    color="primary"
                    size="medium"
                />
            </Box>
        </Box>
    );
};
