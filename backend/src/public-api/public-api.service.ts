import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { CreateApiKeyDto } from './public-api.dto';
import * as crypto from 'crypto';

@Injectable()
export class PublicApiService {
  constructor(private readonly prisma: PrismaService) {}

  async listProjects(params: {
    methodology?: string;
    country?: string;
    vintage?: number;
    limit: number;
    cursor?: string;
  }) {
    const { methodology, country, vintage, limit, cursor } = params;
    const projects = await this.prisma.carbonProject.findMany({
      where: {
        status: 'Verified',
        ...(methodology && { methodology }),
        ...(country && { country }),
        ...(vintage && { vintageYear: vintage }),
      },
      select: {
        projectId: true,
        name: true,
        methodology: true,
        country: true,
        projectType: true,
        vintageYear: true,
        methodologyScore: true,
        totalCreditsIssued: true,
        totalCreditsRetired: true,
        status: true,
        createdAt: true,
      },
      take: limit,
      ...(cursor && { cursor: { id: cursor }, skip: 1 }),
      orderBy: { createdAt: 'desc' },
    });

    return {
      data: projects,
      meta: {
        count: projects.length,
        nextCursor: projects.length === limit ? projects[projects.length - 1]?.projectId : null,
      },
    };
  }

  async getCreditBatch(batchId: string) {
    const batch = await this.prisma.creditBatch.findUnique({
      where: { batchId },
      select: {
        batchId: true,
        projectId: true,
        vintageYear: true,
        amount: true,
        serialStart: true,
        serialEnd: true,
        status: true,
        issuedAt: true,
        project: {
          select: { name: true, methodology: true, country: true },
        },
      },
    });
    if (!batch) throw new NotFoundException(`Credit batch ${batchId} not found`);
    return batch;
  }

  async verifyCertificate(retirementId: string) {
    const record = await this.prisma.retirementRecord.findUnique({
      where: { retirementId },
      select: {
        retirementId: true,
        amount: true,
        retiredBy: true,
        beneficiary: true,
        retirementReason: true,
        vintageYear: true,
        serialNumbers: true,
        txHash: true,
        retiredAt: true,
        isValid: true,
        certificateCid: true,
        project: {
          select: { name: true, methodology: true, country: true },
        },
      },
    });
    if (!record) throw new NotFoundException(`Certificate ${retirementId} not found`);
    return {
      ...record,
      ipfsUrl: record.certificateCid
        ? `https://gateway.pinata.cloud/ipfs/${record.certificateCid}`
        : null,
    };
  }

  async createApiKey(dto: CreateApiKeyDto) {
    const key = `cl_${crypto.randomBytes(24).toString('hex')}`;
    const record = await this.prisma.apiKey.create({
      data: {
        key,
        organizationName: dto.organizationName,
        contactEmail: dto.contactEmail,
      },
      select: {
        id: true,
        key: true,
        organizationName: true,
        contactEmail: true,
        createdAt: true,
      },
    });
    return record;
  }
}
