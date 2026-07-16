import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

@Injectable()
export class AuditService {
  constructor(private prisma: PrismaService) {}

  async createLog(data: {
    userId?: string;
    action: string;
    resourceId?: string;
    ipAddress?: string;
    result?: string;
    metadata?: any;
  }) {
    return this.prisma.auditLog.create({
      data: {
        userId: data.userId,
        action: data.action,
        resourceId: data.resourceId,
        ipAddress: data.ipAddress,
        result: data.result,
        metadata: data.metadata || {},
      },
    });
  }

  async findAll(query: { limit?: number; offset?: number; userId?: string; action?: string }) {
    return this.prisma.auditLog.findMany({
      where: {
        ...(query.userId && { userId: query.userId }),
        ...(query.action && { action: query.action }),
      },
      take: Number(query.limit) || 50,
      skip: Number(query.offset) || 0,
      orderBy: { timestamp: 'desc' },
    });
  }
}
