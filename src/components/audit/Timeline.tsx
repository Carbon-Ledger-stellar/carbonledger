import React from 'react';
import {
    Timeline as MuiTimeline,
    TimelineItem,
    TimelineSeparator,
    TimelineConnector,
    TimelineContent,
    TimelineDot,
    TimelineOppositeContent,
} from '@mui/lab';
import {
    Card,
    CardContent,
    Typography,
    Chip,
    Box,
    Link,
    Tooltip,
    IconButton,
} from '@mui/material';
import {
    AddCircle as MintIcon,
    SwapHoriz as TransferIcon,
    Delete as RetireIcon,
    OpenInNew as OpenIcon,
} from '@mui/icons-material';
import { AuditEvent } from '../../types/audit';

interface TimelineProps {
    events: AuditEvent[];
}

const getEventIcon = (type: AuditEvent['type']) => {
    switch (type) {
        case 'mint':
            return <MintIcon />;
        case 'transfer':
            return <TransferIcon />;
        case 'retire':
            return <RetireIcon />;
        default:
            return null;
    }
};

const getEventColor = (type: AuditEvent['type']) => {
    switch (type) {
        case 'mint':
            return 'success';
        case 'transfer':
            return 'primary';
        case 'retire':
            return 'error';
        default:
            return 'grey';
    }
};

const getEventLabel = (type: AuditEvent['type']) => {
    switch (type) {
        case 'mint':
            return 'Mint';
        case 'transfer':
            return 'Transfer';
        case 'retire':
            return 'Retire';
        default:
            return type;
    }
};

const formatDate = (date: string) => {
    return new Date(date).toLocaleString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
};

export const Timeline: React.FC<TimelineProps> = ({ events }) => {
    if (events.length === 0) {
        return (
            <Box sx={{ textAlign: 'center', py: 4 }}>
                <Typography variant="body1" color="text.secondary">
                    No events found for this serial number
                </Typography>
            </Box>
        );
    }

    return (
        <MuiTimeline position="right">
            {events.map((event, index) => (
                <TimelineItem key={event.id}>
                    <TimelineOppositeContent color="text.secondary">
                        <Typography variant="caption">
                            {formatDate(event.date)}
                        </Typography>
                    </TimelineOppositeContent>
                    <TimelineSeparator>
                        <TimelineDot color={getEventColor(event.type)}>
                            {getEventIcon(event.type)}
                        </TimelineDot>
                        {index < events.length - 1 && <TimelineConnector />}
                    </TimelineSeparator>
                    <TimelineContent>
                        <Card variant="outlined" sx={{ mb: 2 }}>
                            <CardContent>
                                <Box display="flex" alignItems="center" gap={1} mb={1}>
                                    <Chip
                                        label={getEventLabel(event.type)}
                                        color={getEventColor(event.type)}
                                        size="small"
                                    />
                                    <Typography variant="body2" color="text.secondary">
                                        {event.amount} units
                                    </Typography>
                                </Box>

                                <Typography variant="body2">
                                    {event.type === 'mint' && (
                                        <>
                                            Minted by operator:{' '}
                                            <Tooltip title={event.parties.operator}>
                                                <Typography component="span" variant="body2" sx={{ fontFamily: 'monospace' }}>
                                                    {event.parties.operator?.slice(0, 10)}...
                                                </Typography>
                                            </Tooltip>
                                        </>
                                    )}
                                    {event.type === 'transfer' && (
                                        <>
                                            From:{' '}
                                            <Tooltip title={event.parties.from}>
                                                <Typography component="span" variant="body2" sx={{ fontFamily: 'monospace' }}>
                                                    {event.parties.from?.slice(0, 10)}...
                                                </Typography>
                                            </Tooltip>
                                            {' → '}
                                            To:{' '}
                                            <Tooltip title={event.parties.to}>
                                                <Typography component="span" variant="body2" sx={{ fontFamily: 'monospace' }}>
                                                    {event.parties.to?.slice(0, 10)}...
                                                </Typography>
                                            </Tooltip>
                                        </>
                                    )}
                                    {event.type === 'retire' && (
                                        <>
                                            Retired by:{' '}
                                            <Tooltip title={event.parties.from}>
                                                <Typography component="span" variant="body2" sx={{ fontFamily: 'monospace' }}>
                                                    {event.parties.from?.slice(0, 10)}...
                                                </Typography>
                                            </Tooltip>
                                        </>
                                    )}
                                </Typography>

                                <Box display="flex" alignItems="center" gap={1} mt={1}>
                                    <Typography variant="caption" color="text.secondary">
                                        TX:
                                    </Typography>
                                    <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>
                                        {event.transactionId.slice(0, 16)}...
                                    </Typography>
                                    <Link
                                        href={`https://stellar.expert/explorer/testnet/tx/${event.transactionId}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                    >
                                        <IconButton size="small" aria-label="view on explorer">
                                            <OpenIcon fontSize="small" />
                                        </IconButton>
                                    </Link>
                                </Box>
                            </CardContent>
                        </Card>
                    </TimelineContent>
                </TimelineItem>
            ))}
        </MuiTimeline>
    );
};
