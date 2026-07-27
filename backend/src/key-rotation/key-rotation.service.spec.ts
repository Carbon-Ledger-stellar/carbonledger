import { Test, TestingModule } from '@nestjs/testing';
import { KeyRotationService } from './key-rotation.service';
import { PrismaService } from '../prisma.service';
import { ConfigService } from '@nestjs/config';

describe('KeyRotationService', () => {
  let service: KeyRotationService;
  let prismaService: PrismaService;
  let configService: ConfigService;

  const mockPrismaService = {
    keyRotation: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
    },
  };

  const mockConfigService = {
    get: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        KeyRotationService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get<KeyRotationService>(KeyRotationService);
    prismaService = module.get<PrismaService>(PrismaService);
    configService = module.get<ConfigService>(ConfigService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('initiateOracleRotation', () => {
    const validOracleRequest = {
      newOraclePublicKey: 'GABC123...',
      newOracleSecretKey: 'SABC123...',
      reason: 'Test rotation',
    };

    it('should initiate oracle rotation successfully', async () => {
      const mockRotation = {
        id: 'rotation-1',
        type: 'oracle',
        status: 'pending',
        reason: 'Test rotation',
        metadata: {},
        createdAt: new Date(),
      };

      mockPrismaService.keyRotation.create.mockResolvedValue(mockRotation);
      mockConfigService.get.mockReturnValue('mock-value');

      const result = await service.initiateOracleRotation(validOracleRequest);

      expect(result).toEqual({
        id: 'rotation-1',
        type: 'oracle',
        status: 'pending',
        initiatedAt: mockRotation.createdAt,
        reason: 'Test rotation',
        metadata: {},
      });
    });

    it('should reject invalid keypair', async () => {
      const invalidRequest = {
        ...validOracleRequest,
        newOraclePublicKey: 'GINVALID',
        newOracleSecretKey: 'SINVALID',
      };

      await expect(service.initiateOracleRotation(invalidRequest)).rejects.toThrow(
        'Public key does not match secret key'
      );
    });
  });

  describe('initiateAdminRotation', () => {
    const validAdminRequest = {
      newAdminPublicKey: 'GXYZ123...',
      newAdminSecretKey: 'SXYZ123...',
      reason: 'Test admin rotation',
      multiSigRequired: true,
      timeLockHours: 24,
    };

    it('should initiate admin rotation with time-lock', async () => {
      const mockRotation = {
        id: 'rotation-2',
        type: 'admin',
        status: 'pending',
        reason: 'Test admin rotation',
        metadata: {},
        createdAt: new Date(),
        scheduledAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      };

      mockPrismaService.keyRotation.create.mockResolvedValue(mockRotation);

      const result = await service.initiateAdminRotation(validAdminRequest);

      expect(result.status).toBe('pending');
      expect(result.scheduledAt).toBeDefined();
    });
  });

  describe('initiateJWTRotation', () => {
    const validJWTRequest = {
      newJWTSecret: 'new-secret-key-32-chars-minimum',
      reason: 'Test JWT rotation',
      transitionPeriodHours: 24,
    };

    it('should initiate JWT rotation with zero-downtime', async () => {
      const mockRotation = {
        id: 'rotation-3',
        type: 'jwt',
        status: 'in_progress',
        reason: 'Test JWT rotation',
        metadata: {},
        createdAt: new Date(),
      };

      mockPrismaService.keyRotation.create.mockResolvedValue(mockRotation);
      mockConfigService.get.mockReturnValue('old-secret');

      const result = await service.initiateJWTRotation(validJWTRequest);

      expect(result.status).toBe('in_progress');
      expect(result.type).toBe('jwt');
    });

    it('should reject short JWT secrets', async () => {
      const invalidRequest = {
        ...validJWTRequest,
        newJWTSecret: 'short',
      };

      await expect(service.initiateJWTRotation(invalidRequest)).rejects.toThrow(
        'JWT secret must be at least 32 characters'
      );
    });
  });

  describe('getRotationStatus', () => {
    it('should return rotation status', async () => {
      const mockRotation = {
        id: 'rotation-1',
        type: 'oracle',
        status: 'completed',
        reason: 'Test rotation',
        metadata: {},
        createdAt: new Date(),
        completedAt: new Date(),
      };

      mockPrismaService.keyRotation.findUnique.mockResolvedValue(mockRotation);

      const result = await service.getRotationStatus('rotation-1');

      expect(result).toEqual({
        id: 'rotation-1',
        type: 'oracle',
        status: 'completed',
        initiatedAt: mockRotation.createdAt,
        completedAt: mockRotation.completedAt,
        reason: 'Test rotation',
        metadata: {},
      });
    });

    it('should return null for non-existent rotation', async () => {
      mockPrismaService.keyRotation.findUnique.mockResolvedValue(null);

      const result = await service.getRotationStatus('non-existent');

      expect(result).toBeNull();
    });
  });

  describe('getAllRotations', () => {
    it('should return all rotations', async () => {
      const mockRotations = [
        {
          id: 'rotation-1',
          type: 'oracle',
          status: 'completed',
          reason: 'Oracle rotation',
          metadata: {},
          createdAt: new Date(),
        },
        {
          id: 'rotation-2',
          type: 'admin',
          status: 'pending',
          reason: 'Admin rotation',
          metadata: {},
          createdAt: new Date(),
        },
      ];

      mockPrismaService.keyRotation.findMany.mockResolvedValue(mockRotations);

      const result = await service.getAllRotations();

      expect(result).toHaveLength(2);
      expect(result[0].type).toBe('oracle');
      expect(result[1].type).toBe('admin');
    });
  });
});
