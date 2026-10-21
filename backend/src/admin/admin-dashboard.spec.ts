import { Test, TestingModule } from '@nestjs/testing';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { PauseService } from './pause.service';
import { PrismaService } from '../prisma.service';

describe('Admin Dashboard API with Pause Status (#1226)', () => {
  let controller: AdminController;
  let adminService: AdminService;
  let prisma: any;

  const mockEvents = [
    {
      id: 'event-1',
      contract: 'credit',
      action: 'pause',
      admin: 'GADMIN_LATEST_11111111111111111111111111111111111111111111111',
      reason: 'Critical bug mitigation',
      pausedUntil: new Date('2026-10-20T00:00:00Z'),
      txHash: '0xabc123',
      occurredAt: new Date('2026-10-19T10:00:00Z'),
    },
    {
      id: 'event-2',
      contract: 'credit',
      action: 'unpause',
      admin: 'GADMIN_PREV_22222222222222222222222222222222222222222222222',
      reason: 'Routine resumption',
      pausedUntil: null,
      txHash: '0xdef456',
      occurredAt: new Date('2026-10-18T10:00:00Z'),
    },
  ];

  beforeEach(async () => {
    prisma = {
      pauseEvent: {
        findMany: jest.fn().mockResolvedValue(mockEvents),
      },
      adminConfig: {
        findMany: jest.fn().mockResolvedValue([
          { key: 'carbon_credit_paused', value: 'true' },
          { key: 'carbon_credit_paused_until', value: String(Math.floor(Date.now() / 1000) + 3600) },
          { key: 'carbon_credit_reason', value: 'Critical bug mitigation' },
        ]),
      },
      carbonProject: { count: jest.fn().mockResolvedValue(12) },
      creditBatch: { count: jest.fn().mockResolvedValue(45) },
      retirementRecord: { count: jest.fn().mockResolvedValue(88) },
      user: { count: jest.fn().mockResolvedValue(5) },
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminController],
      providers: [
        {
          provide: AdminService,
          useValue: {
            getDashboard: jest.fn(),
          },
        },
        {
          provide: PauseService,
          useValue: {},
        },
        {
          provide: PrismaService,
          useValue: prisma,
        },
      ],
    }).compile();

    controller = module.get<AdminController>(AdminController);
    adminService = module.get<AdminService>(AdminService);
  });

  describe('AdminController.getDashboard (#1226)', () => {
    it('delegates to AdminService.getDashboard', async () => {
      const mockResult = {
        is_paused: true,
        pause_history: mockEvents,
        current_admin: 'GADMIN_LATEST_11111111111111111111111111111111111111111111111',
        pause_reason: 'Critical bug mitigation',
        stats: { totalProjects: 12 },
      };
      (adminService.getDashboard as jest.Mock).mockResolvedValue(mockResult);

      const res = await controller.getDashboard();
      expect(res).toEqual(mockResult);
      expect(res.is_paused).toBe(true);
      expect(res.pause_history).toHaveLength(2);
      expect(res.current_admin).toBe('GADMIN_LATEST_11111111111111111111111111111111111111111111111');
      expect(res.pause_reason).toBe('Critical bug mitigation');
    });

    it('getAdminStats returns same dashboard payload', async () => {
      const mockResult = { is_paused: false };
      (adminService.getDashboard as jest.Mock).mockResolvedValue(mockResult);

      const res = await controller.getAdminStats();
      expect(res).toEqual(mockResult);
    });
  });

  describe('AdminService.getDashboard implementation', () => {
    it('correctly aggregates is_paused, last 10 events, current admin, and reason when paused', async () => {
      const realAdminService = new AdminService(
        prisma,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
      );

      const dashboard = await realAdminService.getDashboard();

      expect(dashboard.is_paused).toBe(true);
      expect(dashboard.isPaused).toBe(true);
      expect(dashboard.pause_history).toHaveLength(2);
      expect(dashboard.current_admin).toBe('GADMIN_LATEST_11111111111111111111111111111111111111111111111');
      expect(dashboard.paused_by).toBe('GADMIN_LATEST_11111111111111111111111111111111111111111111111');
      expect(dashboard.pause_reason).toBe('Critical bug mitigation');
      expect(dashboard.stats.totalProjects).toBe(12);
      expect(prisma.pauseEvent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 10,
          orderBy: { occurredAt: 'desc' },
        }),
      );
    });

    it('returns is_paused=false and null current_admin/reason when unpaused', async () => {
      prisma.adminConfig.findMany.mockResolvedValue([
        { key: 'carbon_credit_paused', value: 'false' },
        { key: 'carbon_marketplace_paused', value: 'false' },
      ]);
      const unpauseEvents = [
        {
          id: 'event-unpause',
          contract: 'credit',
          action: 'unpause',
          admin: 'GADMIN_UNPAUSED',
          reason: null,
          pausedUntil: null,
          txHash: '0x123',
          occurredAt: new Date(),
        },
      ];
      prisma.pauseEvent.findMany.mockResolvedValue(unpauseEvents);

      const realAdminService = new AdminService(
        prisma,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
      );

      const dashboard = await realAdminService.getDashboard();

      expect(dashboard.is_paused).toBe(false);
      expect(dashboard.current_admin).toBeNull();
      expect(dashboard.pause_reason).toBeNull();
      expect(dashboard.pause_history).toEqual(unpauseEvents);
    });
  });
});
