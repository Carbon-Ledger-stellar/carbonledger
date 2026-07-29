import { Controller, Get, Post, Patch, Param, Body, Query, UseGuards } from '@nestjs/common';
import { VerifiersService } from './verifiers.service';
import { ApplyVerifierDto, ReviewVerifierDto } from './verifiers.dto';
import { Public, Roles } from '../auth/decorators';
import { CheckPolicies, PoliciesGuard, UserSubject } from '../policies';

@Controller('verifiers')
export class VerifiersController {
  constructor(private readonly verifiersService: VerifiersService) {}

  @Post('apply')
  @Public()
  apply(@Body() dto: ApplyVerifierDto) {
    return this.verifiersService.apply(dto);
  }

  @Get()
  @Roles('admin', 'verifier')
  @UseGuards(PoliciesGuard)
  @CheckPolicies((ability) => ability.can('read', UserSubject))
  findAll(@Query('status') status?: string) {
    return this.verifiersService.findAll(status);
  }

  @Get(':id')
  @Roles('admin', 'verifier')
  @UseGuards(PoliciesGuard)
  @CheckPolicies((ability) => ability.can('read', UserSubject))
  findOne(@Param('id') id: string) {
    return this.verifiersService.findOne(id);
  }

  @Patch(':id/review')
  @Roles('admin')
  @UseGuards(PoliciesGuard)
  @CheckPolicies((ability) => ability.can('update', UserSubject))
  review(@Param('id') id: string, @Body() dto: ReviewVerifierDto) {
    return this.verifiersService.review(id, dto);
  }

  @Get(':publicKey/pending-projects')
  @Roles('verifier', 'admin')
  @UseGuards(PoliciesGuard)
  @CheckPolicies((ability) => ability.can('read', UserSubject))
  pendingProjects(@Param('publicKey') publicKey: string) {
    return this.verifiersService.pendingProjects(publicKey);
  }
}
