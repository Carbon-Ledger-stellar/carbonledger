import { Injectable, NotFoundException, ConflictException, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma.service";
import { RedisService } from "../redis.service"; // ⚠️ ASSUMED PATH — verify this matches your actual file
import { projectDetailCacheKey, PROJECT_DETAIL_CACHE_TTL_SECONDS } from "../cache/cache.constants"; // ⚠️ ASSUMED — verify these exist here
import {
  RegisterProjectDto,
  UpdateProjectStatusDto,
  SearchProjectsDto,
  PaginatedProjectsResponse,
  ProjectStatus,
  OracleFreshness,
  CreateProjectDto,
} from "./projects.dto";
import { MailService } from "../mail/mail.service";
import { MailEvent } from "../mail/mail.constants";
import { ProjectStateMachineService, ProjectStatus as SMStatus } from "./project-state-machine.service";
import { v4 as uuidv4 } from "uuid";

/**
 * Identity of the authenticated caller, attached to the request by RolesGuard
 * (see auth/roles.guard.ts — request.user = { publicKey, role }).
 * Passed explicitly into every ProjectsService method that reads project data,
 * so scoping can never be forgotten by a future caller of this service.
 */
export interface CallerContext {
  publicKey: string;
  role: string; // 'admin' | 'verifier' | 'project_developer' | 'corporation'
}

/**
 * Mutates and returns `where` to add an ownership filter when the caller is a
 * project_developer. Every other role (admin, verifier, corporation) gets no
 * added restriction — full visibility, per the RBAC decision for this feature.
 */
function scopeWhereForCaller(where: any, caller: CallerContext): any {
  if (caller.role === 'project_developer') {
    where.ownerAddress = caller.publicKey;
  }
  return where;
}

@Injectable()
export class ProjectsService {
  private readonly logger = new Logger(ProjectsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
    private readonly stateMachine: ProjectStateMachineService,
    private readonly redisService: RedisService,
  ) {}

  // ── Authenticated, role-scoped reads ─────────────────────────────────────

  async findAll(
    filters: { methodology?: string; country?: string; vintage?: number; cursor?: string; limit?: number },
    caller: CallerContext,
  ) {
    const take = Math.min(Math.max(filters.limit ?? 20, 1), 100);
    const where: any = scopeWhereForCaller(
      {
        ...(filters.methodology && { methodology: filters.methodology }),
        ...(filters.country && { country: filters.country }),
        ...(filters.vintage && { vintageYear: filters.vintage }),
      },
      caller,
    );

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

  async searchProjects(searchDto: SearchProjectsDto, caller: CallerContext): Promise<PaginatedProjectsResponse> {
    const {
      search, methodology, country, status, vintageYear,
      oracleFreshness, cursor, limit = 20, sortBy = 'createdAt', sortOrder = 'desc',
    } = searchDto;

    const where: any = {};

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

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
      const now = new Date();
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

      switch (oracleFreshness) {
        case OracleFreshness.FRESH:
          where.lastMonitoringAt = { gte: thirtyDaysAgo };
          break;
        case OracleFreshness.STALE:
          where.OR = [
            { lastMonitoringAt: { lt: thirtyDaysAgo } },
            { lastMonitoringAt: null },
          ];
          break;
        case OracleFreshness.UNKNOWN:
          where.lastMonitoringAt = null;
          break;
      }
    }

    // Ownership scoping — added right before execution, after all filter
    // building, so it always applies regardless of which branches above ran.
    scopeWhereForCaller(where, caller);

    const orderBy: any = {};
    orderBy[sortBy] = sortOrder;

    const [projects, total] = await Promise.all([
      this.prisma.carbonProject.findMany({
        where,
        orderBy,
        take: limit + 1,
        cursor: cursor ? { id: cursor } : undefined,
        skip: cursor ? 1 : 0,
        select: {
          id: true,
          projectId: true,
          name: true,
          description: true,
          methodology: true,
          country: true,
          projectType: true,
          status: true,
          vintageYear: true,
          totalCreditsIssued: true,
          totalCreditsRetired: true,
          metadataCid: true,
          verifierAddress: true,
          ownerAddress: true,
          methodologyScore: true,
          coordinates: true,
          lastMonitoringAt: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      this.prisma.carbonProject.count({ where }),
    ]);

    const hasMore = projects.length > limit;
    const nextCursor = hasMore ? projects[projects.length - 2].id : undefined;
    if (hasMore) {
      projects.pop();
    }

    return {
      projects,
      nextCursor,
      hasMore,
      total,
    };
  }

  /**
   * Public-facing read: verified projects only, status is hardcoded and
   * never influenced by caller input. Field list is deliberately narrower
   * than searchProjects — no ownerAddress / verifierAddress exposed to
   * anonymous callers.
   */
  async findVerifiedProjects(filters: {
    methodology?: string;
    country?: string;
    vintage?: number;
    cursor?: string;
    limit?: number;
  }) {
    const take = Math.min(Math.max(filters.limit ?? 20, 1), 100);
    const where: any = {
      status: 'Verified',
      ...(filters.methodology && { methodology: filters.methodology }),
      ...(filters.country && { country: filters.country }),
      ...(filters.vintage && { vintageYear: filters.vintage }),
    };

    const [projects, total_count] = await Promise.all([
      this.prisma.carbonProject.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: take + 1,
        cursor: filters.cursor ? { id: filters.cursor } : undefined,
        skip: filters.cursor ? 1 : 0,
        select: {
          id: true,
          projectId: true,
          name: true,
          description: true,
          methodology: true,
          country: true,
          projectType: true,
          status: true,
          vintageYear: true,
          totalCreditsIssued: true,
          totalCreditsRetired: true,
          metadataCid: true,
          coordinates: true,
          createdAt: true,
        },
      }),
      this.prisma.carbonProject.count({ where }),
    ]);

    const hasMore = projects.length > take;
    const next_cursor = hasMore ? projects[projects.length - 2].id : undefined;
    if (hasMore) projects.pop();

    return { projects, next_cursor, total_count };
  }

  /**
   * Authenticated single-project read. Runs the ownership check AFTER the
   * cache lookup on every path (hit or miss) — see getProjectOrThrow below.
   * This is the fix for the old bug where a cache hit returned data before
   * any authorization could run.
   */
  async findOne(projectId: string, caller: CallerContext) {
    const project = await this.getProjectOrThrow(projectId);

    if (caller.role === 'project_developer' && project.ownerAddress !== caller.publicKey) {
      // 404, not 403 — don't confirm existence of a project the caller can't see.
      throw new NotFoundException(`Project ${projectId} not found`);
    }

    return project;
  }

  /**
   * Internal fetch-or-throw, no authorization applied. Used by findOne
   * (which adds the check itself) and by internal mutation flows
   * (updateStatus/verify/reject) which are already gated at the controller
   * level via @Roles('admin'/'verifier') and don't need ownership scoping.
   */
  private async getProjectOrThrow(projectId: string) {
    const cacheKey = projectDetailCacheKey(projectId);
    const cachedProject = await this.redisService.get<any>(cacheKey);

    if (cachedProject) {
      return cachedProject;
    }

    this.logger.log(`Project detail cache miss: ${cacheKey}`);

    const project = await this.prisma.carbonProject.findUnique({ where: { projectId } });
    if (!project) throw new NotFoundException(`Project ${projectId} not found`);

    await this.redisService.set(cacheKey, project, PROJECT_DETAIL_CACHE_TTL_SECONDS);
    return project;
  }

  // ── Mutations (unchanged from before, aside from calling getProjectOrThrow) ─

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
    return {
      projectId: project.projectId,
      id: project.id,
      txHash: null,
      status: project.status,
      metadataCid,
    };
  }

  async updateStatus(projectId: string, dto: UpdateProjectStatusDto, actor = 'admin') {
    const project = await this.getProjectOrThrow(projectId);
    await this.stateMachine.transition(
      projectId,
      project.status as SMStatus,
      dto.status as SMStatus,
      actor,
      dto.reason,
    );
    const updated = await this.prisma.carbonProject.update({
      where: { projectId },
      data: { status: dto.status },
    });
    await this.invalidateProjectCache(projectId);
    return updated;
  }

  async verify(projectId: string, verifierPublicKey: string) {
    const project = await this.getProjectOrThrow(projectId);
    await this.stateMachine.transition(
      projectId,
      project.status as SMStatus,
      'Verified',
      verifierPublicKey,
    );
    const updated = await this.prisma.carbonProject.update({
      where: { projectId },
      data: { status: 'Verified' },
    });

    const owner = await this.prisma.user.findUnique({ where: { publicKey: updated.ownerAddress } });
    if (owner && owner.email && owner.isSubscribed) {
      await this.mailService.sendEmail(owner.email, MailEvent.PROJECT_APPROVED, {
        projectName: updated.name,
        projectId: updated.projectId,
        projectLink: `${process.env.FRONTEND_URL}/projects/${updated.projectId}`,
        to: owner.email,
      });
    }

    await this.invalidateProjectCache(projectId);
    return updated;
  }

  async reject(projectId: string, verifierPublicKey: string, reason: string) {
    const project = await this.getProjectOrThrow(projectId);
    await this.stateMachine.transition(
      projectId,
      project.status as SMStatus,
      'Rejected',
      verifierPublicKey,
      reason,
    );
    const updated = await this.prisma.carbonProject.update({
      where: { projectId },
      data: { status: 'Rejected' },
    });
    await this.invalidateProjectCache(projectId);
    return updated;
  }

  // ⚠️ ASSUMED implementation — you had a working invalidateProjectCache
  // that wasn't in the snippet you pasted. If yours does more (e.g. also
  // invalidating a list cache), keep yours and discard this stub.
  private async invalidateProjectCache(projectId: string): Promise<void> {
    const cacheKey = projectDetailCacheKey(projectId);
    await this.redisService.del(cacheKey);
  }
}