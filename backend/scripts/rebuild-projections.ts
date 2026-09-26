#!/usr/bin/env ts-node
/**
 * Projection Rebuild Script
 *
 * Replays all immutable `CreditEvent` records in PostgreSQL and reconstructs
 * the `CreditProjection` read models.
 *
 * Usage:
 *   npx ts-node scripts/rebuild-projections.ts
 */

import { PrismaClient } from '@prisma/client';
import { createHmac } from 'crypto';

async function main() {
  console.log('🔄 Starting Credit Lifecycle Projection Rebuild...');
  const prisma = new PrismaClient();

  try {
    const allEvents = await prisma.creditEvent.findMany({
      orderBy: { timestamp: 'asc' },
    });

    console.log(`Found ${allEvents.length} credit events to replay.`);

    const eventsByBatch = new Map<string, any[]>();
    for (const event of allEvents) {
      const list = eventsByBatch.get(event.creditBatchId) ?? [];
      list.push(event);
      eventsByBatch.set(event.creditBatchId, list);
    }

    let rebuiltCount = 0;
    for (const [batchId, events] of eventsByBatch) {
      let state: Record<string, any> = {};
      let lastEvent = events[0];

      for (const event of events) {
        lastEvent = event;
        if (event.newState && typeof event.newState === 'object') {
          state = { ...state, ...(event.newState as Record<string, unknown>) };
        }
      }

      await (prisma as any).creditProjection.upsert({
        where: { creditBatchId: batchId },
        create: {
          creditBatchId:   batchId,
          projectId:       (state.projectId as string) ?? 'unknown-project',
          ownerPublicKey:  (state.ownerPublicKey as string) ?? (state.actor as string) ?? 'system',
          status:          (state.status as string) ?? 'Issued',
          amountAvailable: Number(state.amountAvailable ?? state.amount ?? 0),
          amountRetired:   Number(state.amountRetired ?? 0),
          pricePerCredit:  state.pricePerCredit ? String(state.pricePerCredit) : null,
          txHash:          lastEvent.txHash,
          lastEventType:   lastEvent.eventType,
          version:         events.length,
        },
        update: {
          projectId:       (state.projectId as string) ?? undefined,
          ownerPublicKey:  (state.ownerPublicKey as string) ?? undefined,
          status:          (state.status as string) ?? undefined,
          amountAvailable: Number(state.amountAvailable ?? state.amount ?? 0),
          amountRetired:   Number(state.amountRetired ?? 0),
          pricePerCredit:  state.pricePerCredit ? String(state.pricePerCredit) : undefined,
          txHash:          lastEvent.txHash,
          lastEventType:   lastEvent.eventType,
          version:         events.length,
        },
      });

      rebuiltCount++;
      console.log(`  ✅ Rebuilt batch ${batchId} (v${events.length}, status=${state.status ?? 'Issued'})`);
    }

    console.log(`✨ Rebuild complete! Successfully rebuilt ${rebuiltCount} credit projections.`);
  } catch (error) {
    console.error('❌ Error rebuilding projections:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
