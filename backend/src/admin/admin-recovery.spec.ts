/**
 * Unit tests: admin soft-delete / recovery endpoints (#964).
 *
 * AdminService delegates the actual deletedAt mutation to the owning
 * resource service (ProjectsService/CreditsService/RetirementsService) and
 * is responsible only for writing the audit trail entry — these tests verify
 * that wiring, not the resource services' own validation (covered in their
 * own spec files).
 */
import { Test, TestingModule } from '@nestjs/testing';
import { AdminService } from './admin.service';
import { PrismaService } from '../prisma.service';
import { IndexerService } from '../indexer/indexer.service';
import { OracleService } from '../oracle/oracle.service';
import { RedisService } from '../redis.service';
import { StellarNetworkService } from '../common/stellar-network.service';
import { ProjectsService } from '../projects/projects.service';
import { CreditsService } from '../credits/credits.service';
import { RetirementsService } from '../retirements/retirements.service';
import { AuditService } from '../audit/audit.service';

describe('AdminService - soft delete / recovery (#964)', () => {
  let adminService: AdminService;

  const mockProjectsService = {
    softDeleteProject: jest.fn(),
    restoreProject: jest.fn(),
  };
  const mockCreditsService = {
    softDeleteBatch: jest.fn(),
    restoreBatch: jest.fn(),
  };
  const mockRetirementsService = {
    softDeleteRetirement: jest.fn(),
    restoreRetirement: jest.fn(),
  };
  const mockAuditService = {
    createLog: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminService,
        { provide: PrismaService, useValue: {} },
        { provide: IndexerService, useValue: {} },
        { provide: OracleService, useValue: {} },
        { provide: RedisService, useValue: {} },
        { provide: StellarNetworkService, useValue: {} },
        { provide: ProjectsService, useValue: mockProjectsService },
        { provide: CreditsService, useValue: mockCreditsService },
        { provide: RetirementsService, useValue: mockRetirementsService },
        { provide: AuditService, useValue: mockAuditService },
      ],
    }).compile();

    adminService = module.get(AdminService);
  });

  it('soft-deletes a project and records an audit log entry', async () => {
    mockProjectsService.softDeleteProject.mockResolvedValue({ projectId: 'proj-1', deletedAt: new Date() });

    const result = await adminService.softDeleteProject('proj-1', 'GADMIN...', 'GDPR request');

    expect(mockProjectsService.softDeleteProject).toHaveBeenCalledWith('proj-1', 'GDPR request');
    expect(mockAuditService.createLog).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'GADMIN...', action: 'project.soft_delete', resourceId: 'proj-1' }),
    );
    expect(result.projectId).toBe('proj-1');
  });

  it('restores a project and records an audit log entry', async () => {
    mockProjectsService.restoreProject.mockResolvedValue({ projectId: 'proj-1', deletedAt: null });

    await adminService.restoreProject('proj-1', 'GADMIN...');

    expect(mockProjectsService.restoreProject).toHaveBeenCalledWith('proj-1');
    expect(mockAuditService.createLog).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'GADMIN...', action: 'project.restore', resourceId: 'proj-1' }),
    );
  });

  it('soft-deletes and restores a credit batch through CreditsService', async () => {
    mockCreditsService.softDeleteBatch.mockResolvedValue({ batchId: 'batch-1', deletedAt: new Date() });
    mockCreditsService.restoreBatch.mockResolvedValue({ batchId: 'batch-1', deletedAt: null });

    await adminService.softDeleteCreditBatch('batch-1', 'GADMIN...', 'duplicate entry');
    await adminService.restoreCreditBatch('batch-1', 'GADMIN...');

    expect(mockCreditsService.softDeleteBatch).toHaveBeenCalledWith('batch-1');
    expect(mockCreditsService.restoreBatch).toHaveBeenCalledWith('batch-1');
    expect(mockAuditService.createLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'credit_batch.soft_delete', resourceId: 'batch-1' }),
    );
    expect(mockAuditService.createLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'credit_batch.restore', resourceId: 'batch-1' }),
    );
  });

  it('soft-deletes and restores a retirement through RetirementsService', async () => {
    mockRetirementsService.softDeleteRetirement.mockResolvedValue({ retirementId: 'ret-1', deletedAt: new Date() });
    mockRetirementsService.restoreRetirement.mockResolvedValue({ retirementId: 'ret-1', deletedAt: null });

    await adminService.softDeleteRetirement('ret-1', 'GADMIN...');
    await adminService.restoreRetirement('ret-1', 'GADMIN...');

    expect(mockRetirementsService.softDeleteRetirement).toHaveBeenCalledWith('ret-1');
    expect(mockRetirementsService.restoreRetirement).toHaveBeenCalledWith('ret-1');
    expect(mockAuditService.createLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'retirement.soft_delete', resourceId: 'ret-1' }),
    );
    expect(mockAuditService.createLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'retirement.restore', resourceId: 'ret-1' }),
    );
  });
});
