import { Module } from '@nestjs/common';
import { VerifiersController } from './verifiers.controller';
import { VerifiersService } from './verifiers.service';
import { PrismaService } from '../prisma.service';
import { AuthModule } from '../auth/auth.module';
import { PoliciesModule } from '../policies/policies.module';

@Module({
  imports: [AuthModule, PoliciesModule],
  controllers: [VerifiersController],
  providers: [VerifiersService, PrismaService],
  exports: [VerifiersService],
})
export class VerifiersModule {}
