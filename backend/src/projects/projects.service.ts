import { Injectable, NotFoundException, ConflictException, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma.service";
import { RegisterProjectDto, UpdateProjectStatusDto, SearchProjectsDto, PaginatedProjectsResponse, ProjectStatus, OracleFreshness, CreateProjectDto } from "./projects.dto";
import { MailService } from "../mail/mail.service";
import { MailEvent } from "../mail/mail.constants";
import { ProjectStateMachineService, ProjectStatus as SMStatus } from "./project-state-machine.service";
import { v4 as uuidv4 } from "uuid";

@Injectable()
export class ProjectsService {
  private readonly logger = new Logger(ProjectsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
    private readonly stateMachine: ProjectStateMachineService,
    private readonly redisService: RedisService,
  ) {}

  async findAll(filters: { methodology?: string; country?: string; vintage?: number; cursor?: string; limit?: number }) {
    const take = Math.min(Math.max(filters.limit ?? 20, 1), 100);
    const where: any = {
      ...(filters.methodology && { methodology: filters.methodology }),
      ...(filters.country     && { country: filters.country }),
      ...(filters.vintage     && { vintageYear: filters.vintage }),
    };

    const [projects, total_count] = await Promise.all([
      this.prisma.carbonProject.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: take + 1,
        cursor: filters.cursor ? { id: filters.cursor } : undefined,
        skip: filters.cursor ? 1 : 0,
      }),
      this.prisma.carbonProject.count({ where }),
    ]);

    const hasMore = projects.length > take;
    const next_cursor = hasMore ? projects[projects.length - 2].id : undefined;
    if (hasMore) projects.pop();

    return { projects, next_cursor, total_count };
  }

  async searchProjects(searchDto: SearchProjectsDto): Promise<PaginatedProjectsResponse> {
    const { search, methodology, country, status, vintageYear, oracleFreshness, cursor, limit = 20, sortBy = 'createdAt', sortOrder = 'desc' } = searchDto;

    // When a free-text query is present, use the PostgreSQL tsvector GIN index
    // for ranked full-text search (#670). Fall back to prisma-only filters
    // otherwise so simple list calls stay on the ORM path.
    if (search) {
      return this.searchProjectsFullText(searchDto);
    }

    // Build where clause (no free-text)
    const where: any = {};

    if (methodology && methodology.length > 0) {
      where.methodology = { in: methodology };
    }
    if (country && country.length > 0) {
      where.country = { in: country };
    }
    if (status && status.length > 0) {
      where.status = { in: status };
    }
    if (vintageYear && vintageYear.length > 0) {
      where.vintageYear = { in: vintageYear };
    }

    if (oracleFreshness) {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      switch (oracleFreshness) {
        case OracleFreshness.FRESH:
          where.lastMonitoringAt = { gte: thirtyDaysAgo };
          break;
        case OracleFreshness.STALE:
          where.OR = [{ lastMonitoringAt: { lt: thirtyDaysAgo } }, { lastMonitoringAt: null }];
          break;
        case OracleFreshness.UNKNOWN:
          where.lastMonitoringAt = null;
          break;
      }
    }

    const orderBy: any = {};
    orderBy[sortBy] = sortOrder;

    const [projects, total] = await Promise.all([
      this.prisma.carbonProject.findMany({
        where,
        orderBy,
        take:   limit + 1,
        cursor: cursor ? { id: cursor } : undefined,
        skip:   cursor ? 1 : 0,
        select: {
          id: true, projectId: true, name: true, description: true,
          methodology: true, country: true, projectType: true, status: true,
          vintageYear: true, totalCreditsIssued: true, totalCreditsRetired: true,
          metadataCid: true, verifierAddress: true, ownerAddress: true,
          methodologyScore: true, coordinates: true, lastMonitoringAt: true,
          createdAt: true, updatedAt: true,
        },
      }),
      this.prisma.carbonProject.count({ where }),
    ]);

    const hasMore   = projects.length > limit;
    const nextCursor = hasMore ? projects[projects.length - 2].id : undefined;
    if (hasMore) projects.pop();

    return { projects, nextCursor, hasMore, total };
  }

  /**
   * Full-text search using the PostgreSQL tsvector GIN index (#670).
   *
   * Issues a single parameterised raw query to leverage `ts_rank` for
   * relevance ordering, then applies structured filters in a sub-select.
   * Falls back gracefully if the searchVector column is not yet present
   * (e.g., running against a pre-migration DB in tests).
   */
  private async searchProjectsFullText(searchDto: SearchProjectsDto): Promise<PaginatedProjectsResponse> {
    const { search, methodology, country, status, vintageYear, limit = 20, cursor } = searchDto;

    // Build parameterised clause fragments. Prisma raw accepts $1, $2 … style.
    // We compose in JS and pass a flat args array.
    const conditions: string[] = ['"searchVector" @@ plainto_tsquery(\'english\', $1)'];
    const args: unknown[]      = [search];
    let   idx = 2;

    if (methodology && methodology.length > 0) {
      conditions.push(`"methodology" = ANY($${idx}::text[])`);
      args.push(methodology);
      idx++;
    }
    if (country && country.length > 0) {
      conditions.push(`"country" = ANY($${idx}::text[])`);
      args.push(country);
      idx++;
    }
    if (status && status.length > 0) {
      conditions.push(`"status" = ANY($${idx}::text[])`);
      args.push(status);
      idx++;
    }
    if (vintageYear && vintageYear.length > 0) {
      conditions.push(`"vintageYear" = ANY($${idx}::int[])`);
      args.push(vintageYear);
      idx++;
    }
    if (cursor) {
      conditions.push(`"id" < $${idx}`);
      args.push(cursor);
      idx++;
    }

    const where = conditions.join(' AND ');
    const take  = limit + 1;

    type ProjectRow = {
      id: string; projectId: string; name: string; description: string | null;
      methodology: string; country: string; projectType: string; status: string;
      vintageYear: number; totalCreditsIssued: string; totalCreditsRetired: string;
      metadataCid: string; verifierAddress: string; ownerAddress: string;
      methodologyScore: number; coordinates: unknown; lastMonitoringAt: Date | null;
      createdAt: Date; updatedAt: Date;
    };

    const [rows, countRows] = await Promise.all([
      this.prisma.$queryRawUnsafe<ProjectRow[]>(
        `SELECT id, "projectId", name, description, methodology, country,
                "projectType", status, "vintageYear", "totalCreditsIssued",
                "totalCreditsRetired", "metadataCid", "verifierAddress",
                "ownerAddress", "methodologyScore", coordinates,
                "lastMonitoringAt", "createdAt", "updatedAt"
         FROM "CarbonProject"
         WHERE ${where}
         ORDER BY ts_rank("searchVector", plainto_tsquery('english', $1)) DESC
         LIMIT ${take}`,
        ...args,
      ),
      this.prisma.$queryRawUnsafe<[{ count: bigint }]>(
        `SELECT COUNT(*)::bigint AS count FROM "CarbonProject" WHERE ${where}`,
        ...args,
      ),
    ]);

    const hasMore    = rows.length > limit;
    const nextCursor = hasMore ? rows[rows.length - 2].id : undefined;
    if (hasMore) rows.pop();

    return {
      projects:   rows,
      nextCursor,
      hasMore,
      total: Number(countRows[0]?.count ?? 0),
    };
  }

  async findOne(projectId: string) {
    const cacheKey = projectDetailCacheKey(projectId);
    const cachedProject = await this.redisService.get<any>(cacheKey);

    if (cachedProject) {
      return cachedProject;
    }

    this.logger.log(`Project detail cache miss: ${cacheKey}`);

    const project = await this.prisma.carbonProject.findUnique({ where: { projectId } });
    if (!project) throw new NotFoundException(`Project ${projectId} not found`);

    await this.redisService.set(cacheKey, project, PROJECT_DETAIL_CACHE_TTL_SECONDS);
    if (!project) throw new NotFoundException('Project not found');
    return project;
  }

  async register(dto: RegisterProjectDto) {
    const existing = await this.prisma.carbonProject.findUnique({ where: { projectId: dto.projectId } });
    if (existing) throw new ConflictException(`Project ${dto.projectId} already exists`);
    if (dto.methodologyScore < 70) {
      throw new ConflictException(`Project registration rejected: methodology score ${dto.methodologyScore} is below minimum 70/100`);
    }
    return this.prisma.carbonProject.create({ data: dto });
  }

  async createProject(dto: CreateProjectDto, ownerAddress?: string) {
    const projectId = uuidv4();
    // Upload documents to IPFS: store CIDs as metadataCid (first doc) and coordinates as JSON
    const metadataCid = dto.documents[0] ?? '';
    const data = {
      projectId,
      name: dto.name,
      methodology: dto.methodology,
      description: dto.description,
      coordinates: dto.coordinates as any,
      country: dto.country ?? '',
      projectType: dto.projectType ?? 'carbon_offset',
      ownerAddress: ownerAddress ?? dto.ownerAddress ?? '',
      verifierAddress: dto.verifierAddress ?? '',
      vintageYear: dto.vintageYear ?? new Date().getFullYear(),
      methodologyScore: dto.methodologyScore ?? 70,
      metadataCid,
      status: 'Pending',
    };
    const project = await this.prisma.carbonProject.create({ data });
    // Return project ID and a placeholder txHash (contract call would happen here)
    return {
      projectId: project.projectId,
      id: project.id,
      txHash: null,
      status: project.status,
      metadataCid,
    };
  }

  async updateStatus(projectId: string, dto: UpdateProjectStatusDto, actor = 'admin') {
    const project = await this.findOne(projectId);
    await this.stateMachine.transition(
      projectId,
      project.status as SMStatus,
      dto.status as SMStatus,
      actor,
      dto.reason,
    );
    const updated = await this.prisma.carbonProject.update({
      where: { projectId },
      data:  { status: dto.status },
    });
    await this.invalidateProjectCache(projectId);
    return updated;
  }

  async verify(projectId: string, verifierPublicKey: string) {
    const project = await this.findOne(projectId);
    await this.stateMachine.transition(
      projectId,
      project.status as SMStatus,
      'Verified',
      verifierPublicKey,
    );
    const updated = await this.prisma.carbonProject.update({
      where: { projectId },
      data:  { status: 'Verified' },
    });

    const owner = await this.prisma.user.findUnique({ where: { publicKey: updated.ownerAddress } });
    if (owner && owner.email && owner.isSubscribed) {
      await this.mailService.sendEmail(owner.email, MailEvent.PROJECT_APPROVED, {
        projectName: updated.name,
        projectId:   updated.projectId,
        projectLink: `${process.env.FRONTEND_URL}/projects/${updated.projectId}`,
        to:          owner.email,
      });
    }

    await this.invalidateProjectCache(projectId);
    return updated;
  }

  async reject(projectId: string, verifierPublicKey: string, reason: string) {
    const project = await this.findOne(projectId);
    await this.stateMachine.transition(
      projectId,
      project.status as SMStatus,
      'Rejected',
      verifierPublicKey,
      reason,
    );
    const updated = await this.prisma.carbonProject.update({
      where: { projectId },
      data:  { status: 'Rejected' },
    });
    await this.invalidateProjectCache(projectId);
    return updated;
  }
}
