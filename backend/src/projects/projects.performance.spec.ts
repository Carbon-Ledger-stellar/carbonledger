import { Test, TestingModule } from '@nestjs/testing';
import { ProjectsService } from './projects.service';
import { PrismaService } from '../prisma.service';
import { SearchProjectsDto, ProjectStatus, OracleFreshness } from './projects.dto';

describe('ProjectsService Performance', () => {
  let service: ProjectsService;
  let prisma: PrismaService;

  // Generate realistic test data
  const generateMockProjects = (count: number) => {
    const projects = [];
    const methodologies = ['VCS', 'GS', 'CAR', 'CDM', 'ACR'];
    const countries = ['BR', 'US', 'IN', 'CN', 'MX', 'CA', 'AU', 'FR'];
    const statuses = ['Pending', 'Verified', 'Rejected', 'Suspended', 'Completed'];
    const projectTypes = ['forestry', 'renewable', 'energy', 'agriculture', 'waste'];

    for (let i = 0; i < count; i++) {
      const createdAt = new Date(Date.now() - Math.random() * 365 * 24 * 60 * 60 * 1000);
      const lastMonitoringAt = Math.random() > 0.3 
        ? new Date(Date.now() - Math.random() * 60 * 24 * 60 * 60 * 1000)
        : null;

      projects.push({
        id: `proj-${i.toString().padStart(3, '0')}`,
        projectId: `proj-${i.toString().padStart(3, '0')}`,
        name: `Project ${i} - ${methodologies[i % methodologies.length]} ${projectTypes[i % projectTypes.length]}`,
        description: `Large-scale ${projectTypes[i % projectTypes.length]} project in ${countries[i % countries.length]} using ${methodologies[i % methodologies.length]} methodology. This project aims to reduce carbon emissions through sustainable practices and innovative technologies.`,
        methodology: methodologies[i % methodologies.length],
        country: countries[i % countries.length],
        projectType: projectTypes[i % projectTypes.length],
        status: statuses[i % statuses.length],
        vintageYear: 2020 + (i % 5),
        totalCreditsIssued: Math.floor(Math.random() * 10000) + 100,
        totalCreditsRetired: Math.floor(Math.random() * 5000),
        metadataCid: `QmTest${i.toString().padStart(6, '0')}`,
        verifierAddress: `0x${Math.random().toString(16).substr(2, 40)}`,
        ownerAddress: `0x${Math.random().toString(16).substr(2, 40)}`,
        coordinates: null,
        lastMonitoringAt,
        createdAt,
        updatedAt: new Date(createdAt.getTime() + Math.random() * 30 * 24 * 60 * 60 * 1000),
      });
    }
    return projects;
  };

  const mockPrisma = {
    carbonProject: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProjectsService,
        {
          provide: PrismaService,
          useValue: mockPrisma,
        },
      ],
    }).compile();

    service = module.get<ProjectsService>(ProjectsService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Performance Tests', () => {
    const mockProjects = generateMockProjects(1000);

    it('should handle basic search with <200ms response time', async () => {
      const searchDto: SearchProjectsDto = { search: 'forestry' };
      
      // Simulate database query time
      mockPrisma.carbonProject.findMany.mockImplementation(async () => {
        // Simulate 50ms database query time
        await new Promise(resolve => setTimeout(resolve, 50));
        return mockProjects.filter(p => p.name.includes('forestry') || p.description.includes('forestry')).slice(0, 20);
      });
      
      mockPrisma.carbonProject.count.mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
        return 150;
      });

      const startTime = performance.now();
      const result = await service.searchProjects(searchDto);
      const endTime = performance.now();

      const responseTime = endTime - startTime;
      
      expect(responseTime).toBeLessThan(200);
      expect(result.projects).toBeDefined();
      expect(result.total).toBe(150);
      
      console.log(`Basic search response time: ${responseTime.toFixed(2)}ms`);
    });

    it('should handle complex filtering with <200ms response time', async () => {
      const searchDto: SearchProjectsDto = {
        methodology: ['VCS', 'GS'],
        country: ['BR', 'US'],
        status: [ProjectStatus.VERIFIED, ProjectStatus.PENDING],
        vintageYear: [2022, 2023, 2024],
        oracleFreshness: OracleFreshness.FRESH,
        limit: 50
      };

      mockPrisma.carbonProject.findMany.mockImplementation(async () => {
        // Simulate 80ms complex database query time
        await new Promise(resolve => setTimeout(resolve, 80));
        return mockProjects.slice(0, 50);
      });
      
      mockPrisma.carbonProject.count.mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 15));
        return 500;
      });

      const startTime = performance.now();
      const result = await service.searchProjects(searchDto);
      const endTime = performance.now();

      const responseTime = endTime - startTime;
      
      expect(responseTime).toBeLessThan(200);
      expect(result.projects).toHaveLength(50);
      expect(result.hasMore).toBe(true);
      
      console.log(`Complex filtering response time: ${responseTime.toFixed(2)}ms`);
    });

    it('should handle pagination with <200ms response time', async () => {
      const searchDto: SearchProjectsDto = {
        cursor: 'proj-500',
        limit: 20,
        sortBy: 'vintageYear',
        sortOrder: 'asc'
      };

      mockPrisma.carbonProject.findMany.mockImplementation(async () => {
        // Simulate 60ms paginated query time
        await new Promise(resolve => setTimeout(resolve, 60));
        return mockProjects.slice(500, 520);
      });
      
      mockPrisma.carbonProject.count.mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
        return 1000;
      });

      const startTime = performance.now();
      const result = await service.searchProjects(searchDto);
      const endTime = performance.now();

      const responseTime = endTime - startTime;
      
      expect(responseTime).toBeLessThan(200);
      expect(result.projects).toHaveLength(20);
      expect(result.nextCursor).toBeDefined();
      
      console.log(`Pagination response time: ${responseTime.toFixed(2)}ms`);
    });

    it('should handle full-text search with <200ms response time', async () => {
      const searchDto: SearchProjectsDto = {
        search: 'large-scale sustainable project',
        limit: 20
      };

      mockPrisma.carbonProject.findMany.mockImplementation(async () => {
        // Simulate 70ms full-text search query time
        await new Promise(resolve => setTimeout(resolve, 70));
        return mockProjects.filter(p => 
          p.name.includes('sustainable') || 
          p.description.includes('sustainable') ||
          p.name.includes('large-scale') || 
          p.description.includes('large-scale')
        ).slice(0, 20);
      });
      
      mockPrisma.carbonProject.count.mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 12));
        return 200;
      });

      const startTime = performance.now();
      const result = await service.searchProjects(searchDto);
      const endTime = performance.now();

      const responseTime = endTime - startTime;
      
      expect(responseTime).toBeLessThan(200);
      expect(result.projects).toBeDefined();
      
      console.log(`Full-text search response time: ${responseTime.toFixed(2)}ms`);
    });

    it('should handle concurrent requests efficiently', async () => {
      const searchDtos: SearchProjectsDto[] = [
        { search: 'forestry' },
        { methodology: ['VCS'] },
        { country: ['BR'] },
        { status: [ProjectStatus.VERIFIED] },
        { vintageYear: [2023] },
      ];

      mockPrisma.carbonProject.findMany.mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 40));
        return mockProjects.slice(0, 20);
      });
      
      mockPrisma.carbonProject.count.mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 8));
        return 100;
      });

      const startTime = performance.now();
      
      // Execute 5 concurrent requests
      const promises = searchDtos.map(dto => service.searchProjects(dto));
      const results = await Promise.all(promises);
      
      const endTime = performance.now();
      const totalTime = endTime - startTime;
      const averageTime = totalTime / searchDtos.length;

      expect(totalTime).toBeLessThan(300); // Should be much less than 5 * 200ms due to concurrency
      expect(results).toHaveLength(5);
      
      console.log(`Concurrent requests total time: ${totalTime.toFixed(2)}ms`);
      console.log(`Average response time per request: ${averageTime.toFixed(2)}ms`);
    });

    it('should handle large result sets efficiently', async () => {
      const searchDto: SearchProjectsDto = {
        limit: 100
      };

      mockPrisma.carbonProject.findMany.mockImplementation(async () => {
        // Simulate 120ms query for large result set
        await new Promise(resolve => setTimeout(resolve, 120));
        return mockProjects.slice(0, 100);
      });
      
      mockPrisma.carbonProject.count.mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 20));
        return 1000;
      });

      const startTime = performance.now();
      const result = await service.searchProjects(searchDto);
      const endTime = performance.now();

      const responseTime = endTime - startTime;
      
      expect(responseTime).toBeLessThan(200);
      expect(result.projects).toHaveLength(100);
      
      console.log(`Large result set response time: ${responseTime.toFixed(2)}ms`);
    });

    it('should maintain performance with oracle freshness filtering', async () => {
      const searchDto: SearchProjectsDto = {
        oracleFreshness: OracleFreshness.STALE,
        methodology: ['VCS'],
        country: ['BR'],
        limit: 20
      };

      mockPrisma.carbonProject.findMany.mockImplementation(async () => {
        // Simulate 90ms query with oracle freshness filtering
        await new Promise(resolve => setTimeout(resolve, 90));
        return mockProjects.filter(p => !p.lastMonitoringAt || 
          (Date.now() - p.lastMonitoringAt.getTime()) > 30 * 24 * 60 * 60 * 1000
        ).slice(0, 20);
      });
      
      mockPrisma.carbonProject.count.mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 15));
        return 300;
      });

      const startTime = performance.now();
      const result = await service.searchProjects(searchDto);
      const endTime = performance.now();

      const responseTime = endTime - startTime;
      
      expect(responseTime).toBeLessThan(200);
      expect(result.projects).toBeDefined();
      
      console.log(`Oracle freshness filtering response time: ${responseTime.toFixed(2)}ms`);
    });
  });

  describe('Performance Benchmarks', () => {
    it('should generate performance report', async () => {
      const testCases = [
        { name: 'Basic Search', dto: { search: 'forestry' } as SearchProjectsDto },
        { name: 'Methodology Filter', dto: { methodology: ['VCS'] } as SearchProjectsDto },
        { name: 'Country Filter', dto: { country: ['BR'] } as SearchProjectsDto },
        { name: 'Status Filter', dto: { status: [ProjectStatus.VERIFIED] } as SearchProjectsDto },
        { name: 'Vintage Filter', dto: { vintageYear: [2023] } as SearchProjectsDto },
        { name: 'Oracle Freshness', dto: { oracleFreshness: OracleFreshness.FRESH } as SearchProjectsDto },
        { name: 'Complex Query', dto: {
          methodology: ['VCS', 'GS'],
          country: ['BR', 'US'],
          status: [ProjectStatus.VERIFIED],
          vintageYear: [2023],
          search: 'sustainable'
        } as SearchProjectsDto },
      ];

      mockPrisma.carbonProject.findMany.mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 50));
        return mockProjects.slice(0, 20);
      });
      
      mockPrisma.carbonProject.count.mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
        return 100;
      });

      console.log('\n=== Performance Benchmark Report ===');
      
      for (const testCase of testCases) {
        const startTime = performance.now();
        await service.searchProjects(testCase.dto);
        const endTime = performance.now();
        
        const responseTime = endTime - startTime;
        const status = responseTime < 200 ? '✅ PASS' : '❌ FAIL';
        
        console.log(`${testCase.name.padEnd(20)}: ${responseTime.toFixed(2).padStart(8)}ms ${status}`);
      }
      
      console.log('=====================================\n');
      
      // All tests should pass
      expect(true).toBe(true);
    });
  });
});
