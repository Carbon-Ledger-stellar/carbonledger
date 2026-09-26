import React, { useState, useEffect, useCallback } from 'react';
import {
    TextField,
    Autocomplete,
    CircularProgress,
    Box,
    Button,
    Paper,
} from '@mui/material';
import { Search as SearchIcon } from '@mui/icons-material';
import { AuditService } from '../../services/auditService';

interface SearchBarProps {
    onSearch: (serialNumber: string) => void;
    isLoading?: boolean;
}

export const SearchBar: React.FC<SearchBarProps> = ({ onSearch, isLoading }) => {
    const [inputValue, setInputValue] = useState('');
    const [suggestions, setSuggestions] = useState<string[]>([]);
    const [loading, setLoading] = useState(false);

    const fetchSuggestions = useCallback(async (query: string) => {
        if (!query || query.length < 2) {
            setSuggestions([]);
            return;
        }

        setLoading(true);
        try {
            const results = await AuditService.getSuggestions(query);
            setSuggestions(results);
        } catch (error) {
            console.error('Failed to fetch suggestions:', error);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        const debounceTimer = setTimeout(() => {
            if (inputValue) {
                fetchSuggestions(inputValue);
            }
        }, 300);

        return () => clearTimeout(debounceTimer);
    }, [inputValue, fetchSuggestions]);

    const handleSearch = () => {
        if (inputValue.trim()) {
            onSearch(inputValue.trim());
        }
    };

    return (
        <Paper elevation={2} sx={{ p: 2 }}>
            <Box display="flex" gap={2} alignItems="flex-start">
                <Autocomplete
                    freeSolo
                    options={suggestions}
                    loading={loading}
                    inputValue={inputValue}
                    onInputChange={(_, value) => setInputValue(value)}
                    onChange={(_, value) => {
                        if (value) {
                            onSearch(value);
                        }
                    }}
                    renderInput={(params) => (
                        <TextField
                            {...params}
                            label="Search by Serial Number"
                            placeholder="e.g., CARBON-2024-001"
                            fullWidth
                            variant="outlined"
                            InputProps={{
                                ...params.InputProps,
                                endAdornment: (
                                    <>
                                        {loading && <CircularProgress size={20} />}
                                        {params.InputProps.endAdornment}
                                    </>
                                ),
                            }}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    handleSearch();
                                }
                            }}
                        />
                    )}
                    sx={{ flex: 1 }}
                />
                <Button
                    variant="contained"
                    onClick={handleSearch}
                    disabled={!inputValue.trim() || isLoading}
                    startIcon={<SearchIcon />}
                    sx={{ minWidth: 120, height: 56 }}
                >
                    Search
                </Button>
            </Box>
        </Paper>
    );
};
