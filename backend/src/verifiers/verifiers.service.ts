import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { ApplyVerifierDto, ReviewVerifierDto } from './verifiers.dto';

@Injectable()
export class VerifiersService {
  constructor(private readonly prisma: PrismaService) {}

  apply(dto: ApplyVerifierDto) {
    return this.prisma.verifierApplication.upsert({
      where:  { publicKey: dto.publicKey },
      update: { ...dto, status: 'pending', rejectionReason: null },
      create: dto,
    });
  }

  findAll(status?: string) {
    return this.prisma.verifierApplication.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: 'desc' },
    });
  }

  findOne(id: string) {
    return this.prisma.verifierApplication.findUniqueOrThrow({ where: { id } });
  }

  async review(id: string, dto: ReviewVerifierDto) {
    const app = await this.prisma.verifierApplication.findUnique({ where: { id } });
    if (!app) throw new NotFoundException('Application not found');
    if (app.status !== 'pending') throw new BadRequestException('Application already reviewed');

    const updated = await this.prisma.verifierApplication.update({
      where: { id },
      data: {
        status:          dto.decision,
        approvedBy:      dto.adminPublicKey,
        approvedAt:      dto.decision === 'approved' ? new Date() : null,
        rejectionReason: dto.rejectionReason ?? null,
      },
    });

    // Promote user role to 'verifier' on approval
    if (dto.decision === 'approved') {
      await this.prisma.user.upsert({
        where:  { publicKey: app.publicKey },
        update: { role: 'verifier' },
        create: { publicKey: app.publicKey, role: 'verifier' },
      });
    }

    return updated;
  }

  /** Projects pending verifier review — used by the verifier dashboard */
  pendingProjects(verifierPublicKey: string) {
    return this.prisma.carbonProject.findMany({
      where: { status: 'Pending', verifierAddress: verifierPublicKey },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** Projects this verifier has already attested to (verified or rejected), with issuance volume. */
  async attestationHistory(verifierPublicKey: string, cursor?: string, limit = 20) {
    const projects = await this.prisma.carbonProject.findMany({
      where: {
        verifierAddress: verifierPublicKey,
        status: { in: ['Verified', 'Rejected'] },
      },
      orderBy: { updatedAt: 'desc' },
      take: limit + 1,
      ...(cursor && { cursor: { id: cursor }, skip: 1 }),
    });

    const hasMore = projects.length > limit;
    const page = hasMore ? projects.slice(0, limit) : projects;
    const total = await this.prisma.carbonProject.count({
      where: { verifierAddress: verifierPublicKey, status: { in: ['Verified', 'Rejected'] } },
    });

    return {
      projects: page,
      nextCursor: hasMore ? page[page.length - 1].id : undefined,
      hasMore,
      total,
    };
  }

  /** Paginated attestation fee ledger for a verifier's fee tracker. */
  async feeHistory(verifierPublicKey: string, cursor?: string, limit = 20) {
    const fees = await this.prisma.verifierAttestationFee.findMany({
      where: { verifierPublicKey },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(cursor && { cursor: { id: cursor }, skip: 1 }),
    });

    const hasMore = fees.length > limit;
    const page = hasMore ? fees.slice(0, limit) : fees;
    const total = await this.prisma.verifierAttestationFee.count({ where: { verifierPublicKey } });

    return {
      fees: page,
      nextCursor: hasMore ? page[page.length - 1].id : undefined,
      hasMore,
      total,
    };
  }

  /** Full (unpaginated) fee ledger for CSV export. */
  async allFees(verifierPublicKey: string) {
    return this.prisma.verifierAttestationFee.findMany({
      where: { verifierPublicKey },
      orderBy: { createdAt: 'desc' },
    });
  }

  feesToCsv(fees: Array<Record<string, unknown>>): string {
    if (fees.length === 0) return '';
    const headers = Object.keys(fees[0]);
    const rows = fees.map(row =>
      headers.map(h => JSON.stringify(row[h] ?? '')).join(','),
    );
    return [headers.join(','), ...rows].join('\n');
  }
}
