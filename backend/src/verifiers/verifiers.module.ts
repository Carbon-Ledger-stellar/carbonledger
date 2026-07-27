import { Module } from '@nestjs/common';
import { VerifiersController } from './verifiers.controller';
import { VerifiersService } from './verifiers.service';
import { PrismaService } from '../prisma.service';
import { RolesGuard } from '../auth/roles.guard';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [VerifiersController],
  providers: [VerifiersService, PrismaService, RolesGuard],
  exports: [VerifiersService],
})
export class VerifiersModule {}
