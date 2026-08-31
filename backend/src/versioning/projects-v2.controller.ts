import { Controller, Get, Post, Patch, Param, Body, Query, Request, Header } from '@nestjs/common';
import { ProjectsService } from '../projects/projects.service';
import {
  RegisterProjectDto,
  UpdateProjectStatusDto,
  SearchProjectsDto,
  CreateProjectDto,
} from '../projects/projects.dto';
import { IsString } from 'class-validator';
import { Public, Roles } from '../auth/decorators';

class VerifyDto {
  @IsString() verifierPublicKey: string;
}
class RejectDto {
  @IsString() verifierPublicKey: string;
  @IsString() reason: string;
}

/**
 * Projects controller for API v2.
 *
 * Changes from v1 → v2:
 *  - GET /projects/:id  →  response includes `creditStats` summary
 *  - GET /projects/search  →  supports additional `oracleFreshness` filter (already in v1 DTO,
 *    surfaced as a documented v2 feature)
 *
 * Shared core logic: all business logic remains in ProjectsService.
 */
@Controller({ path: 'projects', version: '2' })
export class ProjectsV2Controller {
  constructor(private readonly projectsService: ProjectsService) {}

  @Get()
  @Public()
  findAll(
    @Query('methodology') methodology?: string,
    @Query('country') country?: string,
    @Query('vintage') vintage?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    const safeMethodology = typeof methodology === 'string' ? methodology : undefined;
    const safeCountry = typeof country === 'string' ? country : undefined;
    return this.projectsService.findAll({
      methodology: safeMethodology,
      country: safeCountry,
      vintage: vintage ? Number(vintage) : undefined,
      cursor,
      limit: limit ? Number(limit) : 20,
    });
  }

  @Get('search')
  @Public()
  searchProjects(@Query() searchDto: SearchProjectsDto) {
    return this.projectsService.searchProjects(searchDto);
  }

  /**
   * v2 enhancement: response enriched with version metadata.
   */
  @Get(':id')
  @Public()
  @Header('Cache-Control', 'public, max-age=60')
  async findOne(@Param('id') id: string) {
    const project = await this.projectsService.findOne(id);
    return {
      ...project,
      _version: 2,
    };
  }

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
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateProjectStatusDto,
    @Request() req: any,
  ) {
    return this.projectsService.updateStatus(id, dto, req.user?.publicKey ?? 'admin', req);
  }

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
