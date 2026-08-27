import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { PrismaService } from '../prisma.service';
import { MailService } from '../mail/mail.service';
import { ProjectStateMachineService } from './project-state-machine.service';
import { RedisService } from '../redis.service';
import { CreateProjectDto, ProjectStatus } from './projects.dto';

describe('ProjectsService - Batch Endpoints', () => {
  let service: ProjectsService;

  const mockPrismaService = {
    carbonProject: {
      create: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn((cb) => cb(mockPrismaService)),
  };

  const mockMailService = { sendEmail: jest.fn().mockResolvedValue(true) };
  const mockStateMachine = { transition: jest.fn().mockResolvedValue(true) };
  const mockRedisService = { get: jest.fn(), set: jest.fn(), del: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProjectsService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: MailService, useValue: mockMailService },
        { provide: ProjectStateMachineService, useValue: mockStateMachine },
        { provide: RedisService, useValue: mockRedisService },
      ],
    }).compile();

    service = module.get<ProjectsService>(ProjectsService);
  });

  describe('batchCreateProjects', () => {
    it('should create multiple projects atomically in a transaction', async () => {
      const items: CreateProjectDto[] = [
        {
          name: 'Amazon Reforestation A',
          methodology: 'VM0007',
          description: 'Project A',
          country: 'Brazil',
          projectType: 'reforestation',
          vintageYear: 2024,
          methodologyScore: 85,
          coordinates: { lat: -3.0, lng: -60.0 },
          documents: [],
        },
        {
          name: 'Amazon Reforestation B',
          methodology: 'VM0007',
          description: 'Project B',
          country: 'Brazil',
          projectType: 'reforestation',
          vintageYear: 2024,
          methodologyScore: 90,
          coordinates: { lat: -3.0, lng: -60.0 },
          documents: [],
        },
      ];

      mockPrismaService.carbonProject.create.mockImplementation(({ data }: any) => {
        return Promise.resolve({ ...data, id: 'cuid-' + data.projectId });
      });

      const result = await service.batchCreateProjects(items, 'GOWNERKEY');

      expect(result.success).toBe(true);
      expect(result.totalProcessed).toBe(2);
      expect(result.results.length).toBe(2);
      expect(result.results[0].status).toBe('success');
      expect(mockPrismaService.$transaction).toHaveBeenCalled();
    });

    it('should throw BadRequestException if empty items array is passed', async () => {
      await expect(service.batchCreateProjects([])).rejects.toThrow(BadRequestException);
    });
  });

  describe('batchUpdateStatus', () => {
    it('should update status of multiple projects in a transaction', async () => {
      const items = [
        { projectId: 'proj-1', status: ProjectStatus.VERIFIED, reason: 'Approved' },
      ];

      mockPrismaService.carbonProject.findMany.mockResolvedValue([
        { projectId: 'proj-1', status: 'Pending', name: 'Project 1' },
      ]);
      mockPrismaService.carbonProject.update.mockResolvedValue({
        projectId: 'proj-1',
        status: 'Verified',
        name: 'Project 1',
      });

      const result = await service.batchUpdateStatus(items, 'admin');

      expect(result.success).toBe(true);
      expect(result.totalProcessed).toBe(1);
      expect(result.results[0].status).toBe('success');
      expect(mockStateMachine.transition).toHaveBeenCalledWith('proj-1', 'Pending', 'Verified', 'admin', 'Approved');
      expect(mockPrismaService.$transaction).toHaveBeenCalled();
    });
  });
});
