import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { UpdateNotificationPreferencesDto } from './notifications.dto';

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async getPreferences(publicKey: string) {
    const user = await this.prisma.user.findUnique({
      where: { publicKey },
      include: { notificationPreferences: true },
    });
    if (!user) throw new NotFoundException('User not found');

    // Return existing prefs or defaults
    return user.notificationPreferences ?? {
      projectApproved: true,
      creditsMinted: true,
      purchaseConfirmed: true,
      retirementConfirmed: true,
    };
  }

  async updatePreferences(publicKey: string, dto: UpdateNotificationPreferencesDto) {
    const user = await this.prisma.user.findUnique({ where: { publicKey } });
    if (!user) throw new NotFoundException('User not found');

    return this.prisma.notificationPreference.upsert({
      where: { userId: user.id },
      update: dto,
      create: {
        userId: user.id,
        projectApproved: dto.projectApproved ?? true,
        creditsMinted: dto.creditsMinted ?? true,
        purchaseConfirmed: dto.purchaseConfirmed ?? true,
        retirementConfirmed: dto.retirementConfirmed ?? true,
      },
    });
  }
}
