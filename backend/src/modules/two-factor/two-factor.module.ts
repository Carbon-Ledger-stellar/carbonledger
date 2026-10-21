import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TwoFactorController } from './two-factor.controller';
import { TwoFactorService } from './two-factor.service';
import { TwoFactorRecoveryCode } from './entities/two-factor-recovery-code.entity';
import { TwoFactorRecoveryCodeService } from './two-factor-recovery-code.service';
import { TwoFactorRecoveryCodeHasher } from './two-factor-recovery-code.hasher';

@Module({
  imports: [TypeOrmModule.forFeature([TwoFactorRecoveryCode])],
  controllers: [TwoFactorController],
  providers: [
    TwoFactorService,
    TwoFactorRecoveryCodeService,
    TwoFactorRecoveryCodeHasher,
  ],
  exports: [TwoFactorService, TwoFactorRecoveryCodeService],
})
export class TwoFactorModule {}
