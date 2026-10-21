import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { Roles } from '../auth/decorators';
import { CheckPolicies, PoliciesGuard } from '../policies';
import { ExperimentsService } from './experiments.service';
import { RecordMetricDto, UpdateExperimentDto } from './experiments.dto';

/**
 * Feature flags for the signed-in user (#1326). Any authenticated role.
 *
 *   GET  /experiments/flags             variant + config per eligible experiment
 *   POST /experiments/:key/exposure     the variant was rendered
 *   POST /experiments/:key/events       a metric happened ({ metric, value? })
 */
@Controller('experiments')
@ApiBearerAuth()
export class ExperimentsController {
  constructor(private readonly experiments: ExperimentsService) {}

  @Get('flags')
  flags(@Req() req: any) {
    return this.experiments.getAssignments(req.user.publicKey, req.user.role);
  }

  @Post(':key/exposure')
  @HttpCode(HttpStatus.OK)
  exposure(@Param('key') key: string, @Req() req: any) {
    return this.experiments.recordExposure(key, req.user.publicKey, req.user.role);
  }

  @Post(':key/events')
  @HttpCode(HttpStatus.OK)
  event(@Param('key') key: string, @Body() dto: RecordMetricDto, @Req() req: any) {
    return this.experiments.recordMetric(key, req.user.publicKey, dto.metric, dto.value);
  }
}

/**
 * Experiment management and results (#1326). Admin only.
 *
 *   GET   /admin/experiments               definitions + current state
 *   GET   /admin/experiments/:key/results  per-variant statistics and decision
 *   PATCH /admin/experiments/:key          change status / rollout % / winner
 */
@Controller('admin/experiments')
@Roles('admin')
@ApiBearerAuth()
@UseGuards(PoliciesGuard)
export class AdminExperimentsController {
  constructor(private readonly experiments: ExperimentsService) {}

  @Get()
  @CheckPolicies((ability) => ability.can('read', 'all'))
  list() {
    return this.experiments.list();
  }

  @Get(':key/results')
  @CheckPolicies((ability) => ability.can('read', 'all'))
  results(@Param('key') key: string) {
    return this.experiments.getResults(key);
  }

  @Patch(':key')
  @CheckPolicies((ability) => ability.can('update', 'all'))
  update(@Param('key') key: string, @Body() dto: UpdateExperimentDto, @Req() req: any) {
    return this.experiments.updateState(key, dto, req.user?.publicKey);
  }
}
