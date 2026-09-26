import { Injectable, NotFoundException, ConflictException, ForbiddenException, Logger, Optional, HttpException, HttpStatus } from "@nestjs/common";
import { PrismaService } from "../prisma.service";
import { RedisService } from "../redis.service";
import { projectDetailCacheKey, PROJECT_DETAIL_CACHE_TTL_SECONDS } from "../cache/cache.constants";
import { CacheInvalidationService } from "../cache/cache.service";
import { CacheService } from "../cache/cache.service";
import { CacheKeyGenerator } from "../cache/cache.decorator";
import {
  RegisterProjectDto,
  UpdateProjectStatusDto,
  SearchProjectsDto,
  PaginatedProjectsResponse,
  ProjectStatus,
  OracleFreshness,
  CreateProjectDto,
  RegisterProjectWithDocumentsDto,
} from "./projects.dto";
import { MailService } from "../mail/mail.service";
import { MailEvent } from "../mail/mail.constants";
import { ProjectStateMachineService, ProjectStatus as SMStatus } from "./project-state-machine.service";
import { randomUUID, randomBytes } from "crypto";
import { sanitizeProjectPayload, sanitizeProjectForResponse } from "../common/sanitization.util";
import { WebhookService } from "../webhook/webhook.service";
import { captureAuditBeforeState } from "../audit/audit-context";
import { IpfsUploadService } from "../uploads/ipfs-upload.service";
import type { Request } from "express";

/** Flat attestation fee, in stroops (1 XLM = 10,000,000 stroops). */
const ATTESTATION_FEE_STROOPS = process.env.VERIFIER_ATTESTATION_FEE_STROOPS ?? "10000000";

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
    private readonly cacheService: CacheService,
    private readonly ipfsUploadService: IpfsUploadService,
    @Optional() private readonly cacheInvalidation?: CacheInvalidationService,
    @Optional() private readonly webhookService?: WebhookService,
  ) {}

  // ── Authenticated, role-scoped reads ─────────────────────────────────────

  async findAll(
    filters: { methodology?: string; country?: string; vintage?: number; cursor?: string; limit?: number; offset?: number },
    caller: CallerContext,
  ) {
    const take = Math.min(Math.max(filters.limit ?? 20, 1), 100);
    const offset = typeof filters.offset === 'number' && filters.offset >= 0 ? filters.offset : 0;
    const where: any = scopeWhereForCaller(
      {
        deletedAt: null,
        ...(filters.methodology && { methodology: filters.methodology }),
        ...(filters.country && { country: filters.country }),
        ...(filters.vintage && { vintageYear: filters.vintage }),
      },
      caller,
    );

    // Try to get from cache first
    const cacheKey = CacheKeyGenerator.projectListingKey(filters);
    const cached = await this.cacheService.getProjectListing(filters);
    if (cached) {
      this.logger.debug(`Cache hit for project listing: ${cacheKey}`);
      return cached;
    }

    const [projects, total] = await Promise.all([
      this.prisma.carbonProject.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: take + 1,
        cursor: filters.cursor ? { id: filters.cursor } : undefined,
        skip: filters.cursor ? 1 : offset,
      }),
      this.prisma.carbonProject.count({ where }),
    ]);

    const hasMore = projects.length > take;
    const nextCursor = hasMore ? projects[take - 1].id : undefined;
    if (hasMore) projects.pop();

    const sanitized = projects.map((project) => sanitizeProjectForResponse(project as Record<string, unknown>));

    const result = {
      data: sanitized,
      projects: sanitized,
      total,
      limit: take,
      offset,
      hasMore,
      nextOffset: hasMore ? offset + take : null,
      nextCursor,
      next_cursor: nextCursor,
      total_count: total,
    };

    // Cache the result
    await this.cacheService.setProjectListing(filters, result);

    return result;
  }

  async searchProjects(searchDto: SearchProjectsDto, caller: CallerContext): Promise<PaginatedProjectsResponse> {
    const {
      search, methodology, country, status, vintageYear,
      oracleFreshness, cursor, limit = 20, offset = 0, sortBy = 'createdAt', sortOrder = 'desc',
    } = searchDto;

    if (search) {
      return this.searchProjectsFullText(searchDto, caller);
    }

    const take = Math.min(Math.max(limit, 1), 100);
    const safeOffset = typeof offset === 'number' && offset >= 0 ? offset : 0;

    const where: any = { deletedAt: null };

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

    scopeWhereForCaller(where, caller);

    const orderBy: any = {};
    orderBy[sortBy] = sortOrder;

    const [projects, total] = await Promise.all([
      this.prisma.carbonProject.findMany({
        where,
        orderBy,
        take: take + 1,
        cursor: cursor ? { id: cursor } : undefined,
        skip: cursor ? 1 : safeOffset,
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

    const hasMore = projects.length > take;
    const nextCursor = hasMore ? projects[take - 1].id : undefined;
    if (hasMore) {
      projects.pop();
    }

    const sanitized = projects.map((project) => sanitizeProjectForResponse(project as Record<string, unknown>));

    return {
      data: sanitized,
      projects: sanitized,
      total,
      limit: take,
      offset: safeOffset,
      hasMore,
      nextOffset: hasMore ? safeOffset + take : null,
      nextCursor,
    };
  }

  /**
   * Full-text search using the PostgreSQL tsvector GIN index (#670).
   *
   * Issues a single parameterised raw query to leverage `ts_rank` for
   * relevance ordering, then applies structured filters in a sub-select.
   * Falls back gracefully if the searchVector column is not yet present
   * (e.g., running against a pre-migration DB in tests).
   *
   * The `caller` is used to add an ownership filter for project_developer
   * role so the scoping applied by the ORM path is consistent here.
   */
  private async searchProjectsFullText(searchDto: SearchProjectsDto, caller: CallerContext): Promise<PaginatedProjectsResponse> {
    const { search, methodology, country, status, vintageYear, limit = 20, offset = 0, cursor } = searchDto;
    const take = Math.min(Math.max(limit, 1), 100);
    const safeOffset = typeof offset === 'number' && offset >= 0 ? offset : 0;

    const where: any = {
      deletedAt: null,
      OR: [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ],
    };

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

    scopeWhereForCaller(where, caller);

    if (cursor) {
      where.id = { lt: cursor };
    }

    const [rows, total] = await Promise.all([
      this.prisma.carbonProject.findMany({
        where,
        take: take + 1,
        skip: cursor ? 0 : safeOffset,
        orderBy: { createdAt: 'desc' },
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

    const hasMore = rows.length > take;
    const nextCursor = hasMore ? rows[take - 1].id : undefined;
    if (hasMore) rows.pop();

    const sanitized = rows.map((project) => sanitizeProjectForResponse(project as Record<string, unknown>));

    return {
      data: sanitized,
      projects: sanitized,
      total,
      limit: take,
      offset: safeOffset,
      hasMore,
      nextOffset: hasMore ? safeOffset + take : null,
      nextCursor,
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
      deletedAt: null,
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

    return sanitizeProjectForResponse(project as Record<string, unknown>);
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

    const project = await this.prisma.carbonProject.findFirst({ where: { projectId, deletedAt: null } });
    if (!project) throw new NotFoundException(`Project ${projectId} not found`);

    const sanitizedProject = sanitizeProjectForResponse(project as Record<string, unknown>);
    await this.redisService.set(cacheKey, sanitizedProject, PROJECT_DETAIL_CACHE_TTL_SECONDS);
    return sanitizedProject;
  }


  // ── Mutations (unchanged from before, aside from calling getProjectOrThrow) ─

  async register(dto: RegisterProjectDto) {
    const sanitizedDto = sanitizeProjectPayload(dto as unknown as Record<string, unknown>) as unknown as RegisterProjectDto;
    const existing = await this.prisma.carbonProject.findFirst({ where: { projectId: sanitizedDto.projectId, deletedAt: null } });
    if (existing) throw new ConflictException(`Project ${sanitizedDto.projectId} already exists`);
    if (sanitizedDto.methodologyScore < 70) {
      throw new ConflictException(`Project registration rejected: methodology score ${sanitizedDto.methodologyScore} is below minimum 70/100`);
    }
    return this.prisma.carbonProject.create({ data: sanitizedDto as any });
  }

  /**
   * Register a project with verification documents via multipart upload.
   *
   * Validates file type (PDF/PNG) and size (10MB max), uploads to IPFS via Pinata,
   * and links the document to the project in the database.
   *
   * @param dto Project registration details
   * @param file Verification document file (PDF or PNG)
   * @param ownerAddress Stellar public key of the owner making the request
   * @returns Project and document upload metadata
   */
  async registerWithDocuments(
    dto: RegisterProjectWithDocumentsDto,
    file: Express.Multer.File,
    ownerAddress?: string,
  ) {
    // Validate that a file was provided
    if (!file) {
      throw new HttpException(
        'Verification document is required',
        HttpStatus.BAD_REQUEST,
      );
    }

    // Validate file type (PDF or PNG only)
    const allowedMimeTypes = ['application/pdf', 'image/png'];
    if (!allowedMimeTypes.includes(file.mimetype)) {
      throw new HttpException(
        'Invalid file type. Only PDF and PNG files are allowed.',
        HttpStatus.BAD_REQUEST,
      );
    }

    // Validate file size (10MB limit)
    const maxSize = 10 * 1024 * 1024; // 10MB in bytes
    if (file.size > maxSize) {
      throw new HttpException(
        `File size exceeds 10MB limit (${(file.size / 1024 / 1024).toFixed(2)}MB)`,
        HttpStatus.BAD_REQUEST,
      );
    }

    // Sanitize the DTO
    const sanitizedDto = sanitizeProjectPayload(dto as unknown as Record<string, unknown>) as unknown as RegisterProjectWithDocumentsDto;

    // Check if project already exists
    const existing = await this.prisma.carbonProject.findFirst({
      where: { projectId: sanitizedDto.projectId, deletedAt: null },
    });
    if (existing) {
      throw new ConflictException(`Project ${sanitizedDto.projectId} already exists`);
    }

    // Validate methodology score
    if (sanitizedDto.methodologyScore < 70) {
      throw new ConflictException(
        `Project registration rejected: methodology score ${sanitizedDto.methodologyScore} is below minimum 70/100`,
      );
    }

    try {
      // Upload document to IPFS
      const uploadResult = await this.ipfsUploadService.uploadToPinata(
        file.originalname || 'verification_document',
        file.mimetype,
        file.buffer,
        file.size,
        'project', // linkedEntityType (not yet created)
        sanitizedDto.projectId, // linkedEntityId
      );

      // Create project in database with IPFS metadata CID
      const projectData = {
        projectId: sanitizedDto.projectId,
        name: sanitizedDto.name,
        methodology: sanitizedDto.methodology,
        description: sanitizedDto.description,
        country: sanitizedDto.country,
        projectType: sanitizedDto.projectType,
        ownerAddress: ownerAddress ?? sanitizedDto.ownerAddress,
        verifierAddress: sanitizedDto.verifierAddress,
        vintageYear: sanitizedDto.vintageYear,
        methodologyScore: sanitizedDto.methodologyScore,
        metadataCid: uploadResult.cid, // Store the CID as metadata
        status: 'Pending',
      };

      const project = await this.prisma.carbonProject.create({
        data: projectData,
      });

      return {
        success: true,
        message: 'Project registered successfully with verification document',
        data: {
          projectId: project.projectId,
          id: project.id,
          name: project.name,
          status: project.status,
          document: {
            id: uploadResult.id,
            cid: uploadResult.cid,
            fileName: file.originalname,
            fileType: file.mimetype,
            fileSize: file.size,
            pinStatus: uploadResult.pinStatus,
            uploadedAt: new Date().toISOString(),
            ipfsGatewayUrl: `https://gateway.pinata.cloud/ipfs/${uploadResult.cid}`,
          },
        },
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      this.logger.error(
        `Project registration with documents failed: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new HttpException(
        'Failed to register project with documents. Please try again.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async createProject(dto: CreateProjectDto, ownerAddress?: string) {
    const sanitizedDto = sanitizeProjectPayload(dto as unknown as Record<string, unknown>) as unknown as CreateProjectDto;
    const projectId = randomUUID();
    const metadataCid = sanitizedDto.documents?.[0] ?? '';
    const data = {
      projectId,
      name: sanitizedDto.name,
      methodology: sanitizedDto.methodology,
      description: sanitizedDto.description,
      coordinates: sanitizedDto.coordinates as any,
      country: sanitizedDto.country ?? '',
      projectType: sanitizedDto.projectType ?? 'carbon_offset',
      ownerAddress: ownerAddress ?? sanitizedDto.ownerAddress ?? '',
      verifierAddress: sanitizedDto.verifierAddress ?? '',
      vintageYear: sanitizedDto.vintageYear ?? new Date().getFullYear(),
      methodologyScore: sanitizedDto.methodologyScore ?? 70,
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

  async updateStatus(projectId: string, dto: UpdateProjectStatusDto, actor = 'admin', req?: Request) {
    const project = await this.getProjectOrThrow(projectId);
    // Snapshot pre-mutation state so AuditInterceptor can record a
    // before/after diff on the resulting audit log entry (#963).
    captureAuditBeforeState(req, project);
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

  /**
   * A verifier attesting to a project they submitted/own is a conflict of
   * interest. `ownerAddress` is the only funding/ownership relationship the
   * current schema tracks, so it's the only signal this check can use.
   */
  private assertNoConflictOfInterest(project: { ownerAddress: string }, verifierPublicKey: string) {
    if (project.ownerAddress === verifierPublicKey) {
      throw new ForbiddenException(
        'Verifiers cannot attest to a project they are financially connected to (project owner match).',
      );
    }
  }

  private async recordAttestationFee(projectId: string, verifierPublicKey: string, decision: 'Verified' | 'Rejected') {
    const txHash = randomBytes(32).toString('hex');
    await this.prisma.verifierAttestationFee.create({
      data: {
        verifierPublicKey,
        projectId,
        decision,
        feeStroops: ATTESTATION_FEE_STROOPS,
        txHash,
      },
    });
    return txHash;
  }

  async verify(projectId: string, verifierPublicKey: string) {
    const project = await this.getProjectOrThrow(projectId);
    this.assertNoConflictOfInterest(project, verifierPublicKey);
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

    const owner = await this.prisma.user.findFirst({ where: { publicKey: updated.ownerAddress, deletedAt: null } });
    if (owner && owner.email && owner.isSubscribed) {
      await this.mailService.sendEmail(owner.email, MailEvent.PROJECT_APPROVED, {
        projectName: updated.name,
        projectId: updated.projectId,
        projectLink: `${process.env.FRONTEND_URL}/projects/${updated.projectId}`,
        to: owner.email,
      });
    }

    const txHash = await this.recordAttestationFee(projectId, verifierPublicKey, 'Verified');
    await this.invalidateProjectCache(projectId);

    // Dispatch webhook: project.verified
    try {
      if (this.webhookService) {
        await this.webhookService.dispatch('project.verified', {
          projectId: updated.projectId,
          projectName: updated.name,
          methodology: updated.methodology,
          country: updated.country,
          vintageYear: updated.vintageYear,
          ownerAddress: updated.ownerAddress,
          verifierAddress: verifierPublicKey,
          txHash,
          verifiedAt: new Date().toISOString(),
        });
      }
    } catch (webhookError) {
      this.logger.warn(`Failed to dispatch webhook: ${webhookError instanceof Error ? webhookError.message : String(webhookError)}`);
    }

    return { ...updated, txHash };
  }

  async reject(projectId: string, verifierPublicKey: string, reason: string) {
    const project = await this.getProjectOrThrow(projectId);
    this.assertNoConflictOfInterest(project, verifierPublicKey);
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
    const txHash = await this.recordAttestationFee(projectId, verifierPublicKey, 'Rejected');
    await this.invalidateProjectCache(projectId);
    return { ...updated, txHash };
  }

  async softDeleteProject(projectId: string, reason: string, caller?: CallerContext) {
    const project = await this.prisma.carbonProject.findFirst({ where: { projectId, deletedAt: null } });
    if (!project) throw new NotFoundException(`Project ${projectId} not found`);

    if (caller?.role === 'project_developer' && project.ownerAddress !== caller.publicKey) {
      throw new NotFoundException(`Project ${projectId} not found`);
    }

    const retentionDays = this.getRetentionDays();
    const retentionUntil = new Date(Date.now() + retentionDays * 24 * 60 * 60 * 1000);
    const anonymousName = `Deleted Project ${project.projectId}`;

    const updated = await this.prisma.carbonProject.update({
      where: { id: project.id },
      data: {
        deletedAt: new Date(),
        deletionReason: reason,
        retentionUntil,
        name: anonymousName,
        description: null,
        metadataCid: '',
        verifierAddress: '',
        ownerAddress: '',
      },
    });

    await this.invalidateProjectCache(projectId);
    return updated;
  }

  /**
   * Admin recovery (#964): un-hides a soft-deleted project by clearing
   * deletedAt/deletionReason/retentionUntil.
   *
   * Note: softDeleteProject anonymizes name/description/metadataCid/
   * verifierAddress/ownerAddress at delete time (GDPR-style scrub) — that
   * data is gone for good, restoring only reverses the *visibility* of the
   * row, not the redaction. This is intentional, not a bug.
   */
  async restoreProject(projectId: string) {
    const project = await this.prisma.carbonProject.findFirst({
      where: { projectId, deletedAt: { not: null } },
    });
    if (!project) throw new NotFoundException(`Deleted project ${projectId} not found`);

    const restored = await this.prisma.carbonProject.update({
      where: { id: project.id },
      data: { deletedAt: null, deletionReason: null, retentionUntil: null },
    });

    await this.invalidateProjectCache(projectId);
    return restored;
  }

  private getRetentionDays(): number {
    const raw = Number(process.env.DATA_RETENTION_DAYS ?? process.env.RETENTION_DAYS ?? '90');
    return Number.isFinite(raw) && raw > 0 ? raw : 90;
  }

  private async invalidateProjectCache(projectId: string): Promise<void> {
    const cacheKey = projectDetailCacheKey(projectId);
    await this.redisService.del(cacheKey);
    // Also invalidate listings cache — a project status change (verify, reject,
    // suspend) can make active listings stale.
    if (this.cacheInvalidation) {
      await this.cacheInvalidation.invalidateAllListings();
    }
  }
}
