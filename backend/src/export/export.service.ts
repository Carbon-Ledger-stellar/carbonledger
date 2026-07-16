import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

@Injectable()
export class ExportService {
  constructor(private prisma: PrismaService) {}

  async getProjects(filters: any) {
    return this.prisma.carbonProject.findMany({
      where: {
        ...(filters.startDate && { createdAt: { gte: new Date(filters.startDate) } }),
        ...(filters.endDate && { createdAt: { lte: new Date(filters.endDate) } }),
        ...(filters.methodology && { methodology: filters.methodology }),
        ...(filters.country && { country: filters.country }),
      },
    });
  }

  async getRetirements(filters: any) {
    return this.prisma.retirementRecord.findMany({
      where: {
        ...(filters.startDate && { retiredAt: { gte: new Date(filters.startDate) } }),
        ...(filters.endDate && { retiredAt: { lte: new Date(filters.endDate) } }),
        ...(filters.projectId && { projectId: filters.projectId }),
      },
      include: {
        project: {
          select: {
            name: true,
            methodology: true,
            country: true,
          },
        },
      },
    });
  }

  /**
   * Simple CSV serializer
   */
  toCsv(data: any[]) {
    if (!data || data.length === 0) return '';
    
    // Flatten nested objects (like 'project') for better CSV representation
    const flattenedData = data.map(item => {
      const flattened: any = {};
      for (const [key, value] of Object.entries(item)) {
        if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
          for (const [nestedKey, nestedValue] of Object.entries(value)) {
            flattened[`${key}_${nestedKey}`] = nestedValue;
          }
        } else {
          flattened[key] = value;
        }
      }
      return flattened;
    });

    const headers = Object.keys(flattenedData[0]);
    const headerRow = headers.join(',');
    
    const rows = flattenedData.map(obj => {
      return headers.map(header => {
        let val = obj[header];
        if (val === null || val === undefined) return '';
        if (val instanceof Date) return val.toISOString();
        if (Array.isArray(val)) return `"${val.join('; ').replace(/"/g, '""')}"`;
        if (typeof val === 'string') return `"${val.replace(/"/g, '""')}"`;
        return val;
      }).join(',');
    });

    return [headerRow, ...rows].join('\n');
  }
}
