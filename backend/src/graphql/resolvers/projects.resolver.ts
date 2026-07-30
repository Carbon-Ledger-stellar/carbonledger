import { Resolver, Query, Args, Int } from '@nestjs/graphql';
import { ProjectType, ProjectsPage } from '../types/project.type';
import { ProjectsService } from '../../projects/projects.service';
import { Public } from '../../auth/decorators';

@Resolver(() => ProjectType)
export class ProjectsResolver {
  constructor(private readonly projectsService: ProjectsService) {}

  /**
   * List projects with optional filters — mirrors GET /projects.
   * Public endpoint; no authentication required.
   */
  @Query(() => ProjectsPage, { name: 'projects' })
  @Public()
  async getProjects(
    @Args('methodology', { nullable: true }) methodology?: string,
    @Args('country',     { nullable: true }) country?: string,
    @Args('vintage',     { nullable: true, type: () => Int }) vintage?: number,
    @Args('cursor',      { nullable: true }) cursor?: string,
    @Args('limit',       { nullable: true, type: () => Int, defaultValue: 20 }) limit?: number,
  ) {
    const result = await this.projectsService.findAll({
      methodology, country, vintage, cursor, limit: limit ?? 20,
    });
    return {
      projects:   result.projects,
      nextCursor: result.next_cursor,
      hasMore:    !!result.next_cursor,
      total:      result.total_count,
    };
  }

  /**
   * Full-text + structured search across projects — mirrors GET /projects/search.
   * Leverages the PostgreSQL tsvector GIN index (#670).
   * Public endpoint; no authentication required.
   */
  @Query(() => ProjectsPage, { name: 'searchProjects' })
  @Public()
  async searchProjects(
    @Args('search',      { nullable: true }) search?: string,
    @Args('methodology', { nullable: true, type: () => [String] }) methodology?: string[],
    @Args('country',     { nullable: true, type: () => [String] }) country?: string[],
    @Args('status',      { nullable: true, type: () => [String] }) status?: string[],
    @Args('vintageYear', { nullable: true, type: () => [Int] })    vintageYear?: number[],
    @Args('cursor',      { nullable: true }) cursor?: string,
    @Args('limit',       { nullable: true, type: () => Int, defaultValue: 20 }) limit?: number,
    @Args('sortBy',      { nullable: true }) sortBy?: string,
    @Args('sortOrder',   { nullable: true }) sortOrder?: 'asc' | 'desc',
  ) {
    return this.projectsService.searchProjects({
      search, methodology, country,
      status:      status as any,
      vintageYear, cursor, limit: limit ?? 20,
      sortBy:      sortBy as any,
      sortOrder:   sortOrder ?? 'desc',
    });
  }

  /**
   * Fetch a single project by projectId — mirrors GET /projects/:id.
   * Public endpoint; no authentication required.
   */
  @Query(() => ProjectType, { name: 'project' })
  @Public()
  getProject(@Args('projectId') projectId: string) {
    return this.projectsService.findOne(projectId);
  }
}
