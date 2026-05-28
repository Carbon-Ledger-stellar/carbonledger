import { Controller, Get, Query } from '@nestjs/common';
import { AuditService } from './audit.service';
import { Roles } from '../auth/decorators';

@Controller('audit')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  @Roles('admin')
  getLogs(
    @Query('limit')  limit?: number,
    @Query('offset') offset?: number,
    @Query('userId') userId?: string,
    @Query('action') action?: string,
  ) {
    return this.auditService.findAll({ limit, offset, userId, action });
  }
}
