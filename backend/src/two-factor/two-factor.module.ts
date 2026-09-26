import { Module } from '@nestjs/common';
import { TwoFactorService } from './two-factor.service';
import { TwoFactorController } from './two-factor.controller';
import { PrismaService } from '../prisma.service';

@Module({
  providers:   [TwoFactorService, PrismaService],
  controllers: [TwoFactorController],
  exports:     [TwoFactorService],
})
export class TwoFactorModule {}
