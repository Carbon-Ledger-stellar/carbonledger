import { Controller, Get, Post, Patch, Param, Body, Query, Request, Header, UseGuards, BadRequestException } from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { RegisterProjectDto, UpdateProjectStatusDto, SearchProjectsDto, CreateProjectDto, BatchCreateProjectsDto, BatchUpdateProjectStatusDto, UpdateProjectStatusItemDto } from './projects.dto';
import { IsString } from 'class-validator';
import { Public, Roles } from '../auth/decorators';
import { CheckPolicies, PoliciesGuard, ProjectSubject } from '../policies';

class VerifyDto { @IsString() verifierPublicKey: string; }
class RejectDto { @IsString() verifierPublicKey: string; @IsString() reason: string; }

@Controller('projects')
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  // ── Authenticated, role-scoped read endpoints ────────────────────────────

  @Get()
  findAll(
    @Request() req: any,
    @Query('methodology') methodology?: string,
    @Query('country')     country?: string,
    @Query('vintage')     vintage?: string,
    @Query('cursor')      cursor?: string,
    @Query('limit')       limit?: string,
    @Query('offset')      offset?: string,
  ) {
    const safeMethodology = typeof methodology === 'string' ? methodology : undefined;
    const safeCountry     = typeof country     === 'string' ? country     : undefined;
    return this.projectsService.findAll(
      {
        methodology: safeMethodology,
        country:     safeCountry,
        vintage: vintage ? Number(vintage) : undefined,
        cursor,
        limit: limit !== undefined ? Number(limit) : 20,
        offset: offset !== undefined ? Number(offset) : 0,
      },
      req.user,
    );
  }

  @Get('search')
  searchProjects(@Query() searchDto: SearchProjectsDto, @Request() req: any) {
    return this.projectsService.searchProjects(searchDto, req.user);
  }

  @Get(':id')
  @Header('Cache-Control', 'private, max-age=60')
  findOne(@Param('id') id: string, @Request() req: any) {
    return this.projectsService.findOne(id, req.user);
  }

  // ── Project developer actions ────────────────────────────────────────────

  @Post()
  @Roles('project_developer', 'admin')
  @UseGuards(PoliciesGuard)
  @CheckPolicies((ability) => ability.can('create', ProjectSubject))
  create(@Body() dto: CreateProjectDto, @Request() req: any) {
    return this.projectsService.createProject(dto, req.user?.publicKey);
  }

  @Post('batch-create')
  @Roles('project_developer', 'admin')
  @UseGuards(PoliciesGuard)
  @CheckPolicies((ability) => ability.can('create', ProjectSubject))
  batchCreate(@Body() body: BatchCreateProjectsDto | CreateProjectDto[], @Request() req: any) {
    const items = Array.isArray(body) ? body : body?.items;
    if (!items || !Array.isArray(items)) {
      throw new BadRequestException('Request body must be an array of CreateProjectDto or contain an items array');
    }
    return this.projectsService.batchCreateProjects(items, req.user?.publicKey);
  }

  @Post('register')
  @Roles('project_developer', 'admin')
  @UseGuards(PoliciesGuard)
  @CheckPolicies((ability) => ability.can('create', ProjectSubject))
  register(@Body() dto: RegisterProjectDto) {
    return this.projectsService.register(dto);
  }

  @Patch(':id/status')
  @Roles('admin')
  @UseGuards(PoliciesGuard)
  @CheckPolicies((ability) => ability.can('update', ProjectSubject))
  updateStatus(@Param('id') id: string, @Body() dto: UpdateProjectStatusDto, @Request() req: any) {
    return this.projectsService.updateStatus(id, dto, req.user?.publicKey ?? 'admin');
  }

  @Post('batch-update-status')
  @Roles('admin')
  @UseGuards(PoliciesGuard)
  @CheckPolicies((ability) => ability.can('update', ProjectSubject))
  batchUpdateStatus(@Body() body: BatchUpdateProjectStatusDto | UpdateProjectStatusItemDto[], @Request() req: any) {
    const items = Array.isArray(body) ? body : body?.items;
    if (!items || !Array.isArray(items)) {
      throw new BadRequestException('Request body must be an array of UpdateProjectStatusItemDto or contain an items array');
    }
    return this.projectsService.batchUpdateStatus(items, req.user?.publicKey ?? 'admin');
  }

  // ── Verifier actions ─────────────────────────────────────────────────────

  @Post(':id/verify')
  @Roles('verifier', 'admin')
  @UseGuards(PoliciesGuard)
  @CheckPolicies((ability) => ability.can('verify', ProjectSubject))
  verify(@Param('id') id: string, @Body() dto: VerifyDto) {
    return this.projectsService.verify(id, dto.verifierPublicKey);
  }

  @Post(':id/reject')
  @Roles('verifier', 'admin')
  @UseGuards(PoliciesGuard)
  @CheckPolicies((ability) => ability.can('reject', ProjectSubject))
  reject(@Param('id') id: string, @Body() dto: RejectDto) {
    return this.projectsService.reject(id, dto.verifierPublicKey, dto.reason);
  }
}

