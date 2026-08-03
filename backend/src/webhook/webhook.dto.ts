import {
  IsString,
  IsUrl,
  IsArray,
  ArrayNotEmpty,
  IsIn,
  IsBoolean,
  IsOptional,
} from 'class-validator';

export const WEBHOOK_EVENTS = [
  'retirement.confirmed',
  'certificate.ready',
  'credit.purchased',
  'monitoring.data_submitted',
  'oracle.price_updated',
] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export class CreateWebhookSubscriptionDto {
  @IsString()
  ownerAddress: string;

  @IsUrl({ require_tld: false, require_protocol: true }, { message: 'url must be a valid HTTPS URL' })
  url: string;

  @IsArray()
  @ArrayNotEmpty()
  @IsIn(WEBHOOK_EVENTS, { each: true, message: `Each event must be one of: ${WEBHOOK_EVENTS.join(', ')}` })
  events: WebhookEvent[];

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class WebhookSubscriptionResponse {
  id: string;
  ownerAddress: string;
  url: string;
  events: string[];
  active: boolean;
  createdAt: Date;
}

export class WebhookDeliveryLogResponse {
  id: string;
  subscriptionId: string;
  eventType: string;
  url: string;
  statusCode: number | null;
  responseBody: string | null;
  success: boolean;
  attempt: number;
  error: string | null;
  timestamp: Date;
}

export class PaginatedDeliveryLogsResponse {
  logs: WebhookDeliveryLogResponse[];
  total: number;
  page: number;
  pageSize: number;
}

export class PaginatedAdminDeliveryLogsResponse {
  logs: (WebhookDeliveryLogResponse & { subscriptionOwner: string | null })[];
  total: number;
  page: number;
  pageSize: number;
}
