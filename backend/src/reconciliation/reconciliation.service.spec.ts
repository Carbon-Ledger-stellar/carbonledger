import { ReconciliationService } from './reconciliation.service';

describe('ReconciliationService', () => {
  it('auto-resolves mismatches when on-chain retirement evidence exists', async () => {
    const update = jest.fn().mockResolvedValue(undefined);
    const prisma = {
      creditBatch: {
        findMany: jest.fn().mockResolvedValue([
          { batchId: 'batch-1', status: 'Active', amount: 100, projectId: 'project-1', vintageYear: 2024 },
        ]),
        update,
      },
      retirementRecord: {
        findMany: jest.fn().mockResolvedValue([{ amount: 25 }]),
      },
    } as any;

    const service = new ReconciliationService(prisma);
    const result = await service.runReconciliation();

    expect(result.divergencesFound).toBe(1);
    expect(result.autoResolved).toBe(1);
    expect(update).toHaveBeenCalledWith({
      where: { batchId: 'batch-1' },
      data: { status: 'PartiallyRetired' },
    });
  });
});
