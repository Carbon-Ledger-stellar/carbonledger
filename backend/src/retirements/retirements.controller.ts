import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  Res,
  Request,
  ForbiddenException,
  HttpCode,
} from '@nestjs/common';
import { Response } from 'express';
import { IsString } from 'class-validator';
import { RetirementsService } from './retirements.service';
import { ExportRetirementsDto } from './retirements.dto';
import { Public, Roles } from '../auth/decorators';

class VerifyCertificateDto {
  @IsString() retirementId: string;
  @IsString() content: string;
}

@Controller('retirements')
export class RetirementsController {
  constructor(private readonly retirementsService: RetirementsService) {}

  // Fix IDOR: require auth; scope list to the caller's own retirements
  @Get()
  findAll(
    @Request() req: any,
    @Query('cursor') cursor?: string,
    @Query('limit')  limit?: string,
  ) {
    return this.retirementsService.findAll(cursor, limit ? Number(limit) : 20, req.user.publicKey);
  }

  // Fix IDOR: require auth; only the owner or admin may read a specific retirement
  @Get(':id')
  async findOne(@Param('id') id: string, @Request() req: any) {
    const retirement = await this.retirementsService.findOne(id);
    if (retirement.retiredBy !== req.user.publicKey && req.user.role !== 'admin') {
      throw new ForbiddenException('Access denied');
    }
    return retirement;
  }

  @Post('generate-pdf')
  @Roles('corporation', 'admin')
  generatePdf(@Body('retirementId') retirementId: string) {
    return this.retirementsService.generatePdf(retirementId);
  }

  // Fix IDOR: scope export to the caller's own retirements
  @Get('export/csv')
  @Roles('corporation', 'admin')
  async exportCsv(
    @Query() filters: ExportRetirementsDto,
    @Request() req: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    const scopedFilters = { ...filters, retiredBy: req.user.publicKey };
    const csvBuffer = await this.retirementsService.exportCsv(scopedFilters);
    res.set({
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="esg-retirements-${new Date().toISOString().split('T')[0]}.csv"`,
      'Content-Length': csvBuffer.length,
    });
    return csvBuffer;
  }

  @Get('export/pdf')
  @Roles('corporation', 'admin')
  async exportPdf(
    @Query() filters: ExportRetirementsDto,
    @Request() req: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    const scopedFilters = { ...filters, retiredBy: req.user.publicKey };
    const pdfBuffer = await this.retirementsService.exportPdf(scopedFilters);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="esg-report-${new Date().toISOString().split('T')[0]}.pdf"`,
      'Content-Length': pdfBuffer.length,
    });
    return pdfBuffer;
  }

  @Post('verify-integrity')
  @Public()
  @HttpCode(200)
  verifyCertificateIntegrity(@Body() dto: VerifyCertificateDto) {
    return this.retirementsService.verifyCertificateIntegrity(dto.retirementId, dto.content);
  }
}
