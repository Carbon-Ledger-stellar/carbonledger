import { Controller, Get, Query } from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { Public } from '../auth/decorators';

/**
 * Anonymous, unauthenticated read access to Verified projects only.
 * Deliberately a separate controller from ProjectsController so that
 * "what an anonymous caller can see" is never accidentally widened by a
 * future change to the authenticated endpoints above.
 */
@Controller('public/projects')
@Public()
export class PublicProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Get()
  findVerified(
    @Query('methodology') methodology?: string,
    @Query('country')     country?: string,
    @Query('vintage')     vintage?: string,
    @Query('cursor')      cursor?: string,
    @Query('limit')       limit?: string,
  ) {
    const safeMethodology = typeof methodology === 'string' ? methodology : undefined;
    const safeCountry     = typeof country     === 'string' ? country     : undefined;
    return this.projectsService.findVerifiedProjects({
      methodology: safeMethodology,
      country:     safeCountry,
      vintage: vintage ? Number(vintage) : undefined,
      cursor,
      limit: limit ? Number(limit) : 20,
    });
  }
}