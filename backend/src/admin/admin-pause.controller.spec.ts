/**
 * Unit tests: POST /admin/pause and POST /admin/unpause endpoints (#1221, #1222).
 *
 * Verifies acceptance criteria:
 *   - Endpoint requires admin role
 *   - Returns 401 if not admin
 *   - Accepts reason parameter (optional)
 *   - Returns updated contract status
 *   - Emits contract.paused / contract.unpaused events
 *   - Logs unpause action for audit trail (#1222)
 *   - Idempotent: no error if already paused / unpaused
 */
import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { PauseService } from './pause.service';
import { PrismaService } from '../prisma.service';
import { AuditService } from '../audit/audit.service';
import { WebhookService } from '../webhook/webhook.service';
import { PoliciesGuard } from '../policies';

describe('AdminController - POST /admin/pause and /admin/unpause (#1221, #1222)', () => {
  let controller: AdminController;
  let pauseService: PauseService;

  const mockBlockchain = { invokeContract: jest.fn() };
  const mockPrisma = {
    $transaction: jest.fn().mockResolvedValue([]),
    adminConfig: { upsert: jest.fn(), findMany: jest.fn() },
    auditLogEntry: { create: jest.fn().mockResolvedValue({ id: 'ale-1' }) },
    pauseEvent: {
      findMany: jest.fn(),
      count: jest.fn(),
      upsert: jest.fn().mockResolvedValue({ id: 'pe-1' }),
    },
  };
  const mockAudit = { createLog: jest.fn().mockResolvedValue({ id: 'audit-1' }) };
  const mockWebhooks = { dispatch: jest.fn().mockResolvedValue(undefined) };
  const mockAdmin = {};

  const ADMIN_PUBKEY = 'GADMIN1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const NON_ADMIN_PUBKEY = 'GUSER1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const CONTRACT_ID = 'CCREDIT1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ';

  beforeEach(async () => {
    jest.clearAllMocks();
    process.env.CARBON_CREDIT_CONTRACT_ID = CONTRACT_ID;
    process.env.CARBON_MARKETPLACE_CONTRACT_ID = 'CMARKET123';

    mockBlockchain.invokeContract.mockResolvedValue({
      txHash: '0xabc123',
      status: 'success',
      ledger: 100,
      ledgerClosedAt: '',
    });

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminController],
      providers: [
        PauseService,
        { provide: AdminService, useValue: mockAdmin },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditService, useValue: mockAudit },
        { provide: WebhookService, useValue: mockWebhooks },
        { provide: 'IBlockchainProvider', useValue: mockBlockchain },
      ],
    })
      .overrideGuard(PoliciesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(AdminController);
    pauseService = module.get(PauseService);
  });

  // ── POST /api/v1/admin/pause (#1221) ──────────────────────────────────────────

  describe('POST /admin/pause (#1221)', () => {
    it('returns 401 if request has no authenticated user', async () => {
      await expect(controller.pause({}, { req: {} })).rejects.toThrow(UnauthorizedException);
    });

    it('returns 401 if caller is not an admin', async () => {
      const nonAdminReq = { user: { publicKey: NON_ADMIN_PUBKEY, role: 'verifier' } };
      await expect(controller.pause({}, nonAdminReq)).rejects.toThrow(UnauthorizedException);
    });

    it('successfully pauses contract with reason and emits event', async () => {
      // Current state: unpaused
      mockPrisma.adminConfig.findMany.mockResolvedValue([
        { key: 'carbon_credit_paused', value: 'false' },
        { key: 'carbon_credit_paused_until', value: '0' },
      ]);

      const req = { user: { publicKey: ADMIN_PUBKEY, role: 'admin' } };
      const dto = {
        contract: 'carbon_credit',
        reason: 'Suspicious oracle disparity detected',
      };

      const result = await controller.pause(dto, req);

      expect(result).toMatchObject({
        contract: 'carbon_credit',
        contractId: CONTRACT_ID,
        paused: true,
        status: 'paused',
        reason: 'Suspicious oracle disparity detected',
        txHash: '0xabc123',
      });

      // Emits webhook event
      expect(mockWebhooks.dispatch).toHaveBeenCalledWith(
        'contract.paused',
        expect.objectContaining({
          contract: 'carbon_credit',
          admin: ADMIN_PUBKEY,
          reason: 'Suspicious oracle disparity detected',
          txHash: '0xabc123',
        }),
      );

      // Audit log entry created with reason
      expect(mockAudit.createLog).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: ADMIN_PUBKEY,
          action: 'contract.pause',
          resourceId: CONTRACT_ID,
          after: expect.objectContaining({
            reason: 'Suspicious oracle disparity detected',
          }),
        }),
      );
    });

    it('is idempotent: returns updated contract status without error when already paused', async () => {
      const futureExpiry = Math.floor(Date.now() / 1000) + 3600;
      mockPrisma.adminConfig.findMany.mockResolvedValue([
        { key: 'carbon_credit_paused', value: 'true' },
        { key: 'carbon_credit_paused_until', value: String(futureExpiry) },
      ]);

      const req = { user: { publicKey: ADMIN_PUBKEY, role: 'admin' } };
      const dto = { reason: 'Emergency maintenance' };

      const result = await controller.pause(dto, req);

      expect(result).toMatchObject({
        contract: 'carbon_credit',
        paused: true,
        status: 'paused',
        message: 'Contract is already paused',
      });

      // Blockchain invocation must be skipped
      expect(mockBlockchain.invokeContract).not.toHaveBeenCalled();
    });

    it('defaults to carbon_credit and accepts reason parameter as optional', async () => {
      mockPrisma.adminConfig.findMany.mockResolvedValue([
        { key: 'carbon_credit_paused', value: 'false' },
        { key: 'carbon_credit_paused_until', value: '0' },
      ]);

      const req = { user: { publicKey: ADMIN_PUBKEY, role: 'admin' } };
      const result = await controller.pause({}, req);

      expect(result.contract).toBe('carbon_credit');
      expect(result.paused).toBe(true);
      expect(result.status).toBe('paused');
      expect(result.reason).toBeNull();
    });
  });

  // ── POST /api/v1/admin/unpause (#1222) ────────────────────────────────────────

  describe('POST /admin/unpause (#1222)', () => {
    it('returns 401 if request has no authenticated user', async () => {
      await expect(controller.unpause({}, { req: {} })).rejects.toThrow(UnauthorizedException);
    });

    it('returns 401 if caller is not an admin', async () => {
      const nonAdminReq = { user: { publicKey: NON_ADMIN_PUBKEY, role: 'corporation' } };
      await expect(controller.unpause({}, nonAdminReq)).rejects.toThrow(UnauthorizedException);
    });

    it('successfully unpauses contract, logs audit trail and emits event', async () => {
      const futureExpiry = Math.floor(Date.now() / 1000) + 3600;
      mockPrisma.adminConfig.findMany.mockResolvedValue([
        { key: 'carbon_credit_paused', value: 'true' },
        { key: 'carbon_credit_paused_until', value: String(futureExpiry) },
      ]);

      const req = { user: { publicKey: ADMIN_PUBKEY, role: 'admin' } };
      const dto = {
        contract: 'carbon_credit',
        reason: 'Investigation complete, all checks passed',
      };

      const result = await controller.unpause(dto, req);

      expect(result).toMatchObject({
        contract: 'carbon_credit',
        contractId: CONTRACT_ID,
        paused: false,
        status: 'unpaused',
        reason: 'Investigation complete, all checks passed',
        txHash: '0xabc123',
      });

      // Emits webhook event
      expect(mockWebhooks.dispatch).toHaveBeenCalledWith(
        'contract.unpaused',
        expect.objectContaining({
          contract: 'carbon_credit',
          admin: ADMIN_PUBKEY,
          reason: 'Investigation complete, all checks passed',
          txHash: '0xabc123',
        }),
      );

      // Logs unpause action for audit trail
      expect(mockAudit.createLog).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: ADMIN_PUBKEY,
          action: 'contract.unpause',
          resourceId: CONTRACT_ID,
          after: expect.objectContaining({
            contract: 'carbon_credit',
            paused: false,
            reason: 'Investigation complete, all checks passed',
          }),
        }),
      );
    });

    it('is idempotent: returns updated contract status and logs audit trail when already unpaused', async () => {
      mockPrisma.adminConfig.findMany.mockResolvedValue([
        { key: 'carbon_credit_paused', value: 'false' },
        { key: 'carbon_credit_paused_until', value: '0' },
      ]);

      const req = { user: { publicKey: ADMIN_PUBKEY, role: 'admin' } };
      const dto = { reason: 'Routine audit check' };

      const result = await controller.unpause(dto, req);

      expect(result).toMatchObject({
        contract: 'carbon_credit',
        paused: false,
        status: 'unpaused',
        message: 'Contract is already unpaused',
      });

      // Blockchain invocation must be skipped
      expect(mockBlockchain.invokeContract).not.toHaveBeenCalled();

      // Audit trail must still be recorded for the action
      expect(mockAudit.createLog).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: ADMIN_PUBKEY,
          action: 'contract.unpause',
          resourceId: CONTRACT_ID,
        }),
      );
    });

    it('supports contract alias credit / marketplace', async () => {
      mockPrisma.adminConfig.findMany.mockResolvedValue([
        { key: 'carbon_marketplace_paused', value: 'true' },
        { key: 'carbon_marketplace_paused_until', value: String(Math.floor(Date.now() / 1000) + 3600) },
      ]);

      const req = { user: { publicKey: ADMIN_PUBKEY, role: 'admin' } };
      const result = await controller.unpause({ contract: 'marketplace' }, req);

      expect(result.contract).toBe('carbon_marketplace');
      expect(result.paused).toBe(false);
      expect(result.status).toBe('unpaused');
    });
  });
});
