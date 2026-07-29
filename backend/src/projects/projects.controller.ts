import { Controller, Get, Post, Patch, Param, Body, Query, Request, Header } from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { RegisterProjectDto, UpdateProjectStatusDto, SearchProjectsDto, CreateProjectDto } from './projects.dto';
import { IsString } from 'class-validator';
import { Public, Roles } from '../auth/decorators';

class VerifyDto { @IsString() verifierPublicKey: string; }
class RejectDto { @IsString() verifierPublicKey: string; @IsString() reason: string; }

@Controller('projects')
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  // ── Authenticated, role-scoped read endpoints ────────────────────────────
  // @Public() removed from all three below — RolesGuard now requires a valid
  // JWT. No @Roles(...) means "any authenticated role is admitted"; scoping
  // by role happens inside ProjectsService, not by gating roles out here.

  @Get()
  findAll(
    @Request() req: any,
    @Query('methodology') methodology?: string,
    @Query('country')     country?: string,
    @Query('vintage')     vintage?: string,
    @Query('cursor')      cursor?: string,
    @Query('limit')       limit?: string,
  ) {
    const safeMethodology = typeof methodology === 'string' ? methodology : undefined;
    const safeCountry     = typeof country     === 'string' ? country     : undefined;
    return this.projectsService.findAll(
      {
        methodology: safeMethodology,
        country:     safeCountry,
        vintage: vintage ? Number(vintage) : undefined,
        cursor,
        limit: limit ? Number(limit) : 20,
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
  // Note: was "public, max-age=60" — this endpoint now returns caller-specific
  // data (a project_developer's own draft), so a shared/public cache is wrong.
  findOne(@Param('id') id: string, @Request() req: any) {
    return this.projectsService.findOne(id, req.user);
  }

  // ── Project developer actions ────────────────────────────────────────────

  @Post()
  @Roles('project_developer', 'admin')
  create(@Body() dto: CreateProjectDto, @Request() req: any) {
    return this.projectsService.createProject(dto, req.user?.publicKey);
  }

  @Post('register')
  @Roles('project_developer', 'admin')
  register(@Body() dto: RegisterProjectDto) {
    return this.projectsService.register(dto);
  }

  @Patch(':id/status')
  @Roles('admin')
  updateStatus(@Param('id') id: string, @Body() dto: UpdateProjectStatusDto, @Request() req: any) {
    return this.projectsService.updateStatus(id, dto, req.user?.publicKey ?? 'admin');
  }

  // ── Verifier actions ─────────────────────────────────────────────────────

  @Post(':id/verify')
  @Roles('verifier', 'admin')
  verify(@Param('id') id: string, @Body() dto: VerifyDto) {
    return this.projectsService.verify(id, dto.verifierPublicKey);
  }

  @Post(':id/reject')
  @Roles('verifier', 'admin')
  reject(@Param('id') id: string, @Body() dto: RejectDto) {
    return this.projectsService.reject(id, dto.verifierPublicKey, dto.reason);
  }
}