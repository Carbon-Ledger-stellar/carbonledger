import { Controller, Get, Post, Patch, Param, Body, Query, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { AuthGuard } from '@nestjs/passport';
import { VerifiersService } from './verifiers.service';
import { ApplyVerifierDto, ReviewVerifierDto } from './verifiers.dto';
import { RolesGuard } from '../auth/roles.guard';
import { Public, Roles } from '../auth/decorators';

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

  @Get(':publicKey/history')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('verifier', 'admin')
  attestationHistory(
    @Param('publicKey') publicKey: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.verifiersService.attestationHistory(publicKey, cursor, limit ? Number(limit) : 20);
  }

  @Get(':publicKey/fees')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('verifier', 'admin')
  feeHistory(
    @Param('publicKey') publicKey: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.verifiersService.feeHistory(publicKey, cursor, limit ? Number(limit) : 20);
  }

  @Get(':publicKey/fees/export')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('verifier', 'admin')
  async exportFees(@Param('publicKey') publicKey: string, @Res() res: Response) {
    const fees = await this.verifiersService.allFees(publicKey);
    const csv = this.verifiersService.feesToCsv(fees);
    res.header('Content-Type', 'text/csv');
    res.attachment(`verifier-fees-${publicKey.slice(0, 8)}-${Date.now()}.csv`);
    res.send(csv);
  }
}
