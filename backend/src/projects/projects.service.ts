import { Injectable, NotFoundException, ConflictException, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma.service";
import { RedisService } from "../redis/redis.service";
import { RegisterProjectDto, UpdateProjectStatusDto } from "./projects.dto";

const CACHE_TTL = 300; // 5 minutes
const LIST_PATTERN = "projects:list:*";

@Injectable()
export class ProjectsService {
  private readonly logger = new Logger(ProjectsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async findAll(filters: { methodology?: string; country?: string; vintage?: number }) {
    const cacheKey = `projects:list:${JSON.stringify(filters)}`;

    // ── Cache read ─────────────────────────────────────────────────────────
    const cached = await this.redis.get(cacheKey);
    if (cached !== null) {
      this.logger.debug(`Cache HIT — ${cacheKey}`);
      return cached;
    }

    // ── DB fallback (also handles Redis being unavailable) ─────────────────
    this.logger.debug(`Cache MISS — fetching from DB for key: ${cacheKey}`);
    const results = await this.prisma.carbonProject.findMany({
      where: {
        ...(filters.methodology && { methodology: filters.methodology }),
        ...(filters.country     && { country: filters.country }),
        ...(filters.vintage     && { vintageYear: filters.vintage }),
      },
      orderBy: { createdAt: "desc" },
    });

    await this.redis.set(cacheKey, results, CACHE_TTL);
    return results;
  }

  async findOne(projectId: string) {
    const project = await this.prisma.carbonProject.findUnique({ where: { projectId } });
    if (!project) throw new NotFoundException(`Project ${projectId} not found`);
    return project;
  }

  async register(dto: RegisterProjectDto) {
    const existing = await this.prisma.carbonProject.findUnique({ where: { projectId: dto.projectId } });
    if (existing) throw new ConflictException(`Project ${dto.projectId} already exists`);
    const result = await this.prisma.carbonProject.create({ data: dto });

    // Invalidate all project list caches since the collection changed
    await this.redis.delPattern(LIST_PATTERN);
    return result;
  }

  async updateStatus(projectId: string, dto: UpdateProjectStatusDto) {
    await this.findOne(projectId);
    const result = await this.prisma.carbonProject.update({
      where: { projectId },
      data:  { status: dto.status },
    });
    await this.redis.delPattern(LIST_PATTERN);
    return result;
  }

  async verify(projectId: string, verifierPublicKey: string) {
    await this.findOne(projectId);
    const result = await this.prisma.carbonProject.update({
      where: { projectId },
      data:  { status: "Verified" },
    });
    await this.redis.delPattern(LIST_PATTERN);
    return result;
  }

  async reject(projectId: string, verifierPublicKey: string, reason: string) {
    await this.findOne(projectId);
    const result = await this.prisma.carbonProject.update({
      where: { projectId },
      data:  { status: "Rejected" },
    });
    await this.redis.delPattern(LIST_PATTERN);
    return result;
  }
}
