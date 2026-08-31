import axios from 'axios';
import { AuditSearchResult, AuditEvent, FilterOptions } from '../types/audit';

const API_BASE = process.env.REACT_APP_API_URL || '/api';

export const auditApi = {
    /**
     * Search for a serial number
     */
    searchSerial: async (serialNumber: string): Promise<AuditSearchResult> => {
        const response = await axios.get(`${API_BASE}/audit/search`, {
            params: { serialNumber },
        });
        return response.data;
    },

    /**
     * Get events for a serial number with filters
     */
    getEvents: async (
        serialNumber: string,
        filters?: FilterOptions
    ): Promise<AuditEvent[]> => {
        const response = await axios.get(`${API_BASE}/audit/events`, {
            params: {
                serialNumber,
                types: filters?.types?.join(','),
                startDate: filters?.dateRange?.start,
                endDate: filters?.dateRange?.end,
            },
        });
        return response.data;
    },

    /**
     * Get autocomplete suggestions
     */
    getSuggestions: async (query: string): Promise<string[]> => {
        const response = await axios.get(`${API_BASE}/audit/suggestions`, {
            params: { q: query },
        });
        return response.data;
    },
};
