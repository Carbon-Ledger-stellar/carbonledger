import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma.service';

const EVERY_DAY_AT_MIDNIGHT = '0 0 * * *';

@Injectable()
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron(EVERY_DAY_AT_MIDNIGHT)
  async enforceRetentionPolicy() {
    const retentionDays = this.getRetentionDays();
    if (retentionDays <= 0) {
      this.logger.warn('Retention enforcement disabled because retention window is non-positive');
      return;
    }
  
    const now = new Date();
    const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);

    this.logger.log(`Starting retention enforcement with ${retentionDays}-day window`);

    const expiredUsers = await this.prisma.user.findMany({
      where: {
        deletedAt: { not: null },
        retentionUntil: { lte: cutoff },
      },
      select: { id: true, publicKey: true },
    });

    const expiredProjects = await this.prisma.carbonProject.findMany({
      where: {
        deletedAt: { not: null },
        retentionUntil: { lte: cutoff },
      },
      select: { id: true, projectId: true },
    });

    for (const user of expiredUsers) {
      await this.deleteUserRecord(user.id);
    }

    for (const project of expiredProjects) {
      await this.deleteProjectRecord(project.projectId);
    }

    this.logger.log(
      `Retention enforcement completed: deleted ${expiredUsers.length} user(s) and ${expiredProjects.length} project(s)`,
    );
  }

  private getRetentionDays(): number {
    const raw = Number(process.env.DATA_RETENTION_DAYS ?? process.env.RETENTION_DAYS ?? '90');
    return Number.isFinite(raw) && raw > 0 ? raw : 90;
  }

  private async deleteUserRecord(userId: string): Promise<void> {
    const preference = await this.prisma.notificationPreference.findUnique({ where: { userId } });
    if (preference) {
      await this.prisma.notificationPreference.delete({ where: { userId } });
    }

    await this.prisma.user.delete({ where: { id: userId } });
  }

  private async deleteProjectRecord(projectId: string): Promise<void> {
    const project = await this.prisma.carbonProject.findFirst({
      where: { projectId, deletedAt: { not: null } },
      select: { id: true, projectId: true },
    });

    if (!project) {
      return;
    }

    const retirementCount = await this.prisma.retirementRecord.count({ where: { projectId } });
    if (retirementCount > 0) {
      this.logger.warn(`Skipping hard deletion for project ${project.projectId} because retirement records still exist`);
      return;
    }

    await this.prisma.$transaction([
      this.prisma.marketListing.deleteMany({ where: { projectId } }),
      this.prisma.monitoringData.deleteMany({ where: { projectId } }),
      this.prisma.ipfsFile.deleteMany({ where: { projectId: project.id } }),
      this.prisma.creditBatch.deleteMany({ where: { projectId } }),
    ]);

    await this.prisma.carbonProject.delete({ where: { id: project.id } });
  }
}
