import { Controller, Get, Post, Patch, Param, Body, Query, Request } from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { RegisterProjectDto, UpdateProjectStatusDto, SearchProjectsDto } from './projects.dto';
import { IsString } from 'class-validator';
import { Public, Roles } from '../auth/decorators';

class VerifyDto { @IsString() verifierPublicKey: string; }
class RejectDto { @IsString() verifierPublicKey: string; @IsString() reason: string; }

@Controller('projects')
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  // ── Public read endpoints ────────────────────────────────────────────────

  @Get()
  @Public()
  findAll(
    @Query('methodology') methodology?: string,
    @Query('country')     country?: string,
    @Query('vintage')     vintage?: string,
    @Query('cursor')      cursor?: string,
    @Query('limit')       limit?: string,
  ) {
    // Sanitize: reject non-string values (e.g. operator injection via ?methodology[$ne]=VCS)
    const safeMethodology = typeof methodology === 'string' ? methodology : undefined;
    const safeCountry     = typeof country     === 'string' ? country     : undefined;
    return this.projectsService.findAll({
      methodology: safeMethodology,
      country:     safeCountry,
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

  @Get(':id')
  @Public()
  findOne(@Param('id') id: string) {
    return this.projectsService.findOne(id);
  }

  // ── Project developer actions ────────────────────────────────────────────

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
