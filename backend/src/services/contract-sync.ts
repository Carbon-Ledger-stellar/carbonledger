import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SorobanRpc, xdr } from '@stellar/stellar-sdk';
import { ContractEvent } from '../entities/contract-event.entity';
import { SyncCursor } from '../entities/sync-cursor.entity';

const CURSOR_KEY = 'contract-sync';

@Injectable()
export class ContractSyncService implements OnModuleInit {
  private readonly logger = new Logger(ContractSyncService.name);
  private running = false;

  constructor(
    @InjectRepository(ContractEvent)
    private readonly eventRepo: Repository<ContractEvent>,
    @InjectRepository(SyncCursor)
    private readonly cursorRepo: Repository<SyncCursor>,
    private readonly rpc: SorobanRpc.Server,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.sync();
  }

  async sync(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    try {
      const startLedger = await this.resolveStartLedger();
      const latest = await this.rpc.getLatestLedger();

      for (let ledger = startLedger; ledger <= latest.sequence; ledger++) {
        const events = await this.rpc.getEvents({
          startLedger: ledger,
          filters: [{ type: 'contract' }],
        });

        for (const event of events.events) {
          await this.persistEvent(event);
        }

        await this.saveCursor(ledger);
      }
    } finally {
      this.running = false;
    }
  }

  private async resolveStartLedger(): Promise<number> {
    const cursor = await this.cursorRepo.findOne({ where: { key: CURSOR_KEY } });
    if (cursor) {
      return cursor.lastLedger + 1;
    }
    const latest = await this.rpc.getLatestLedger();
    return latest.sequence;
  }

  private async saveCursor(ledger: number): Promise<void> {
    const existing = await this.cursorRepo.findOne({ where: { key: CURSOR_KEY } });
    if (existing) {
      existing.lastLedger = ledger;
      await this.cursorRepo.save(existing);
    } else {
      await this.cursorRepo.save(
        this.cursorRepo.create({ key: CURSOR_KEY, lastLedger: ledger }),
      );
    }
  }

  private async persistEvent(event: SorobanRpc.Api.EventResponse): Promise<void> {
    const exists = await this.eventRepo.findOne({ where: { eventId: event.id } });
    if (exists) {
      return;
    }
    await this.eventRepo.save(
      this.eventRepo.create({
        eventId: event.id,
        ledger: event.ledger,
        contractId: event.contractId,
        topic: event.topic.map((t: xdr.ScVal) => t.toXDR('base64')),
        value: event.value.toXDR('base64'),
      }),
    );
  }
}
