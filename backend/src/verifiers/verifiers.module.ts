import { Module } from '@nestjs/common';
import { VerifiersController } from './verifiers.controller';
import { VerifiersService } from './verifiers.service';
import { PrismaService } from '../prisma.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [VerifiersController],
  providers: [VerifiersService, PrismaService],
  exports: [VerifiersService],
})
export class VerifiersModule {}
