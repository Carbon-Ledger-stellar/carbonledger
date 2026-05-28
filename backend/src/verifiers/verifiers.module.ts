import { Module } from '@nestjs/common';
import { VerifiersController } from './verifiers.controller';
import { VerifiersService } from './verifiers.service';
import { PrismaService } from '../prisma.service';
import { RolesGuard } from '../auth/roles.guard';

@Module({
  controllers: [VerifiersController],
  providers: [VerifiersService, PrismaService, RolesGuard],
  exports: [VerifiersService],
})
export class VerifiersModule {}
