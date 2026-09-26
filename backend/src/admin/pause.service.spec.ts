/**
 * Unit tests: pause feature tracing (#1307).
 *
 * Spans are captured with an in-memory exporter so the tests can assert the
 * trace shape Jaeger will show: one root span per pause/unpause with child
 * spans for the contract call, the DB update and the event emit.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { SpanStatusCode, trace } from '@opentelemetry/api';
import { InMemorySpanExporter, SimpleSpanProcessor, type ReadableSpan } from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { PauseService } from './pause.service';
import { PrismaService } from '../prisma.service';
import { AuditService } from '../audit/audit.service';
import { WebhookService } from '../webhook/webhook.service';

describe('PauseService - tracing (#1307)', () => {
  const exporter = new InMemorySpanExporter();
  const provider = new NodeTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });

  let service: PauseService;

  const mockBlockchain = { invokeContract: jest.fn() };
  const mockPrisma = {
    $transaction: jest.fn().mockResolvedValue([]),
    adminConfig: { upsert: jest.fn(), findMany: jest.fn() },
  };
  const mockAudit = { createLog: jest.fn() };
  const mockWebhooks = { dispatch: jest.fn() };

  const ADMIN = 'GADMIN';
  const CONTRACT_ID = 'CCREDIT';

  beforeAll(() => {
    provider.register();
  });

  afterAll(async () => {
    await provider.shutdown();
    trace.disable();
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    exporter.reset();
    process.env.CARBON_CREDIT_CONTRACT_ID = CONTRACT_ID;
    mockBlockchain.invokeContract.mockResolvedValue({
      txHash: 'tx123', status: 'success', ledger: 42, ledgerClosedAt: '',
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PauseService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditService, useValue: mockAudit },
        { provide: WebhookService, useValue: mockWebhooks },
        { provide: 'IBlockchainProvider', useValue: mockBlockchain },
      ],
    }).compile();

    service = module.get(PauseService);
  });

  const spansByName = () => new Map(exporter.getFinishedSpans().map((s) => [s.name, s]));
  const parentId = (s: ReadableSpan) => (s as any).parentSpanId ?? (s as any).parentSpanContext?.spanId;

  it('traces pause_contract with contract call, DB update and event emit child spans', async () => {
    const until = Math.floor(Date.now() / 1000) + 3600;
    const result = await service.pauseContract('carbon_credit', ADMIN, until);

    const spans = spansByName();
    const root = spans.get('pause.pause_contract')!;
    expect(root).toBeDefined();
    expect(root.attributes['carbonledger.contract.id']).toBe(CONTRACT_ID);
    expect(root.attributes['carbonledger.pause.until']).toBe(until);
    expect(root.attributes['stellar.tx_hash']).toBe('tx123');

    for (const name of ['pause.contract_call', 'pause.db_update', 'pause.event_emit']) {
      const child = spans.get(name)!;
      expect(child).toBeDefined();
      expect(child.spanContext().traceId).toBe(root.spanContext().traceId);
      expect(parentId(child)).toBe(root.spanContext().spanId);
    }
    expect(spans.get('pause.contract_call')!.attributes['rpc.method']).toBe('pause_operations');
    expect(spans.get('pause.event_emit')!.attributes['carbonledger.event.type']).toBe('contract.paused');

    expect(mockBlockchain.invokeContract).toHaveBeenCalledWith({
      contractId: CONTRACT_ID, method: 'pause_operations', args: [ADMIN, until],
    });
    expect(mockWebhooks.dispatch).toHaveBeenCalledWith('contract.paused', expect.objectContaining({ txHash: 'tx123' }));
    expect(result).toMatchObject({ paused: true, txHash: 'tx123', traceId: root.spanContext().traceId });
  });

  it('writes the trace id to the audit log for log correlation', async () => {
    const result = await service.unpauseContract('carbon_credit', ADMIN);

    expect(mockAudit.createLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'contract.unpause',
      resourceId: CONTRACT_ID,
      txHash: 'tx123',
      metadata: { traceId: result.traceId },
    }));
    expect(result.traceId).toMatch(/^[0-9a-f]{32}$/);
  });

  it('traces unpause_contract', async () => {
    await service.unpauseContract('carbon_credit', ADMIN);

    const spans = spansByName();
    expect(spans.get('pause.unpause_contract')).toBeDefined();
    expect(spans.get('pause.contract_call')!.attributes['rpc.method']).toBe('unpause_operations');
    expect(spans.get('pause.event_emit')!.attributes['carbonledger.event.type']).toBe('contract.unpaused');
    expect(mockBlockchain.invokeContract).toHaveBeenCalledWith({
      contractId: CONTRACT_ID, method: 'unpause_operations', args: [ADMIN],
    });
  });

  it('marks spans as errored and skips later steps when the contract call fails', async () => {
    mockBlockchain.invokeContract.mockResolvedValue({
      txHash: 'tx-fail', status: 'failed', error: 'EmergencyPaused', ledger: 1, ledgerClosedAt: '',
    });

    await expect(service.unpauseContract('carbon_credit', ADMIN)).rejects.toThrow('EmergencyPaused');

    const spans = spansByName();
    expect(spans.get('pause.contract_call')!.status.code).toBe(SpanStatusCode.ERROR);
    expect(spans.get('pause.unpause_contract')!.status.code).toBe(SpanStatusCode.ERROR);
    expect(spans.has('pause.db_update')).toBe(false);
    expect(spans.has('pause.event_emit')).toBe(false);
    expect(mockAudit.createLog).not.toHaveBeenCalled();
  });

  it('rejects pause windows outside the contract-enforced 72h bound without calling the contract', async () => {
    const tooFar = Math.floor(Date.now() / 1000) + 73 * 3600;
    await expect(service.pauseContract('carbon_credit', ADMIN, tooFar)).rejects.toThrow('untilTimestamp');
    expect(mockBlockchain.invokeContract).not.toHaveBeenCalled();
  });

  it('fails when the contract id is not configured', async () => {
    delete process.env.CARBON_MARKETPLACE_CONTRACT_ID;
    await expect(service.unpauseContract('carbon_marketplace', ADMIN)).rejects.toThrow(
      'CARBON_MARKETPLACE_CONTRACT_ID is not configured',
    );
  });
});
