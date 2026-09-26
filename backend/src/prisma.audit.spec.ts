import { PrismaService } from './prisma.service';
import { CorrelationIdContext } from './logger/correlation-id.context';

describe('PrismaService Audit Logging', () => {
  let prisma: PrismaService;
  let mockNext: jest.Mock;

  beforeEach(() => {
    // Reset env vars and metrics before each test
    process.env.DATABASE_URL = 'postgresql://fake:fake@localhost:5432/fake';
    prisma = new PrismaService();
    mockNext = jest.fn().mockResolvedValue({ id: 'test-id', someField: 'new-value' });
    
    // Polyfill $use if it doesn't exist just for this test to trigger the block
    if (!(prisma as any).$use) {
      (prisma as any).$use = jest.fn();
    }
  });

  afterEach(async () => {
    await prisma.$disconnect();
    jest.restoreAllMocks();
  });

  it('should create an audit log on Project update', async () => {
    // Mock the $use method on the PrismaClient prototype before instantiation
    const originalUse = (prisma as any).$use;
    const middlewares: any[] = [];
    (prisma as any).$use = jest.fn().mockImplementation((mw) => {
      middlewares.push(mw);
    });
    
    // Re-instantiate to capture the middleware
    prisma = new PrismaService();
    
    // We expect 2 middlewares (metrics and audit)
    expect(middlewares.length).toBeGreaterThanOrEqual(2);
    
    const auditMiddleware = middlewares[1]; // The second one is audit middleware
    
    const nextMock = jest.fn().mockResolvedValue({ id: 'proj-1', name: 'New Name' });
    const findUniqueMock = jest.fn().mockResolvedValue({ id: 'proj-1', name: 'Old Name' });
    
    const mockClient = {
      CarbonProject: {
        findUnique: findUniqueMock,
      },
      auditLog: {
        create: jest.fn().mockResolvedValue({ id: 'audit-1' }),
      }
    };
    
    // Inject the mock methods onto the prisma client instance that the middleware uses
    (prisma as any).CarbonProject = mockClient.CarbonProject;
    (prisma as any).auditLog = mockClient.auditLog;
    
    // Set up the context with an actor
    CorrelationIdContext.run({ correlationId: 'test', actor: 'user123', ip: '127.0.0.1' }, async () => {
      await auditMiddleware.bind(prisma)({
        model: 'CarbonProject',
        action: 'update',
        args: { where: { id: 'proj-1' } }
      }, nextMock);
    });
    
    // wait a tick for async storage propagation if needed
    await new Promise(resolve => setTimeout(resolve, 10));
    
    expect(findUniqueMock).toHaveBeenCalledWith({ where: { id: 'proj-1' } });
    expect(nextMock).toHaveBeenCalled();
    expect(mockClient.auditLog.create).toHaveBeenCalledWith({
      data: {
        userId: 'user123',
        action: 'update',
        resourceId: 'proj-1',
        ipAddress: '127.0.0.1',
        result: 'Success',
        metadata: {
          model: 'CarbonProject',
          oldState: { id: 'proj-1', name: 'Old Name' },
          newState: { id: 'proj-1', name: 'New Name' },
        }
      }
    });
  });
});
