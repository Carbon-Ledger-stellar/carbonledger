import { Controller, Get, Post, Patch, Param, Body, Query } from '@nestjs/common';
import { VerifiersService } from './verifiers.service';
import { ApplyVerifierDto, ReviewVerifierDto } from './verifiers.dto';
import { RolesGuard, Roles } from '../auth/roles.guard';

@Controller('verifiers')
export class VerifiersController {
  constructor(private readonly verifiersService: VerifiersService) {}

  @Post('apply')
  @Public()
  apply(@Body() dto: ApplyVerifierDto) {
    return this.verifiersService.apply(dto);
  }

  @Get()
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('admin', 'verifier')
  findAll(@Query('status') status?: string) {
    return this.verifiersService.findAll(status);
  }

  @Get(':id')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('admin', 'verifier')
  findOne(@Param('id') id: string) {
    return this.verifiersService.findOne(id);
  }

  @Patch(':id/review')
  @Roles('admin')
  review(@Param('id') id: string, @Body() dto: ReviewVerifierDto) {
    return this.verifiersService.review(id, dto);
  }

  @Get(':publicKey/pending-projects')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('verifier', 'admin')
  pendingProjects(@Param('publicKey') publicKey: string) {
    return this.verifiersService.pendingProjects(publicKey);
  }
}
