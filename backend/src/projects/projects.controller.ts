import { Controller, Get, Post, Patch, Param, Body, Query, Request, Header, UseGuards } from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { RegisterProjectDto, UpdateProjectStatusDto, SearchProjectsDto, CreateProjectDto } from './projects.dto';
import { IsString } from 'class-validator';
import { Public, Roles } from '../auth/decorators';
import { CheckPolicies, PoliciesGuard, ProjectSubject } from '../policies';

class VerifyDto { @IsString() verifierPublicKey: string; }
class RejectDto { @IsString() verifierPublicKey: string; @IsString() reason: string; }

@Controller('projects')
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  // ── Authenticated, role-scoped read endpoints ────────────────────────────
  // No @Roles(...) means "any authenticated role is admitted"; scoping
  // by role happens inside ProjectsService, not by gating roles out here.

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
