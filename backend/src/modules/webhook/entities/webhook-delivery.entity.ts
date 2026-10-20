import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum WebhookDeliveryStatus {
  PENDING = 'pending',
  DELIVERED = 'delivered',
  FAILED = 'failed',
  DEAD_LETTER = 'dead_letter',
}

/** Maximum number of delivery attempts before a webhook is dead-lettered. */
export const WEBHOOK_MAX_ATTEMPTS = 8;

@Entity('webhook_deliveries')
export class WebhookDelivery {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid' })
  webhookId: string;

  @Column({ type: 'varchar', length: 255 })
  event: string;

  @Column({ type: 'jsonb' })
  payload: Record<string, any>;

  @Column({ type: 'varchar', length: 2048 })
  url: string;

  @Index()
  @Column({
    type: 'enum',
    enum: WebhookDeliveryStatus,
    default: WebhookDeliveryStatus.PENDING,
  })
  status: WebhookDeliveryStatus;

  @Column({ type: 'int', default: 0 })
  attempts: number;

  @Column({ type: 'int', nullable: true })
  responseStatus: number | null;

  @Column({ type: 'text', nullable: true })
  responseBody: string | null;

  @Column({ type: 'text', nullable: true })
  lastError: string | null;

  /** When the next retry attempt is due (exponential backoff). */
  @Index()
  @Column({ type: 'timestamptz', nullable: true })
  nextAttemptAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  deliveredAt: Date | null;

  /** When the delivery was moved to the dead-letter store after final failure. */
  @Column({ type: 'timestamptz', nullable: true })
  deadLetteredAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
