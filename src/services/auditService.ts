import { AuditEvent, AuditSearchResult } from '../types/audit';

// Mock data for development
const mockEvents: AuditEvent[] = [
    {
        id: '1',
        serialNumber: 'CARBON-2024-001',
        type: 'mint',
        date: '2024-01-15T10:30:00Z',
        parties: {
            operator: 'GABC123...',
        },
        transactionId: '0x1234567890abcdef',
        amount: 1000,
        asset: 'CARBON',
    },
    {
        id: '2',
        serialNumber: 'CARBON-2024-001',
        type: 'transfer',
        date: '2024-02-01T14:20:00Z',
        parties: {
            from: 'GABC123...',
            to: 'GDEF456...',
        },
        transactionId: '0xabcdef1234567890',
        amount: 500,
    },
    {
        id: '3',
        serialNumber: 'CARBON-2024-001',
        type: 'retire',
        date: '2024-03-10T09:15:00Z',
        parties: {
            from: 'GDEF456...',
            operator: 'GABC123...',
        },
        transactionId: '0x7890abcdef123456',
        amount: 500,
    },
];

const mockSuggestions = [
    'CARBON-2024-001',
    'CARBON-2024-002',
    'CARBON-2024-003',
    'CARBON-2024-004',
    'CARBON-2024-005',
];

export class AuditService {
    static async searchSerial(serialNumber: string): Promise<AuditSearchResult> {
        // In production, this would call the API
        const events = mockEvents.filter(e => e.serialNumber === serialNumber);
        
        if (events.length === 0) {
            throw new Error('Serial number not found');
        }

        const retired = events.some(e => e.type === 'retire');
        const retirementEvent = events.find(e => e.type === 'retire');

        return {
            serialNumber,
            events: events.sort((a, b) => 
                new Date(a.date).getTime() - new Date(b.date).getTime()
            ),
            currentOwner: events[events.length - 1]?.parties?.to || events[0]?.parties?.operator,
            retired,
            retiredAt: retirementEvent?.date,
        };
    }

    static async getSuggestions(query: string): Promise<string[]> {
        // In production, this would call the API
        return mockSuggestions.filter(s => 
            s.toLowerCase().includes(query.toLowerCase())
        );
    }

    static async getEvents(
        serialNumber: string,
        filters?: { types?: string[] }
    ): Promise<AuditEvent[]> {
        let events = mockEvents.filter(e => e.serialNumber === serialNumber);
        
        if (filters?.types && filters.types.length > 0) {
            events = events.filter(e => filters.types!.includes(e.type));
        }
        
        return events;
    }
}
