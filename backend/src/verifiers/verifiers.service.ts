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
}
