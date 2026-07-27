import { Module } from '@nestjs/common';
import { KeyRotationController } from './key-rotation.controller';
import { KeyRotationService } from './key-rotation.service';
import { PrismaService } from '../prisma.service';

@Module({
  controllers: [KeyRotationController],
  providers: [KeyRotationService, PrismaService],
  exports: [KeyRotationService],
})
export class KeyRotationModule {}
