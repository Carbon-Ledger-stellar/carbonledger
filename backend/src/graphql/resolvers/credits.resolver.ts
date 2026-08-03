import { Resolver, Query, Args } from '@nestjs/graphql';
import { CreditBatchType, SerialProvenanceType } from '../types/credit.type';
import { CreditsService } from '../../credits/credits.service';
import { Public } from '../../auth/decorators';

@Resolver(() => CreditBatchType)
export class CreditsResolver {
  constructor(private readonly creditsService: CreditsService) {}

  /**
   * Fetch a single credit batch — mirrors GET /credits/batch/:id.
   * Public endpoint; no authentication required.
   */
  @Query(() => CreditBatchType, { name: 'creditBatch' })
  @Public()
  getCreditBatch(@Args('batchId') batchId: string) {
    return this.creditsService.getBatch(batchId);
  }

  /**
   * Full provenance for a serial number (minting batch + transfers + retirement).
   * Allows the frontend to fetch the complete lifecycle in one round-trip
   * instead of chaining multiple REST calls (#672).
   * Public endpoint; no authentication required.
   */
  @Query(() => SerialProvenanceType, { name: 'serialProvenance' })
  @Public()
  getSerialProvenance(@Args('serial') serial: string) {
    return this.creditsService.getSerialProvenance(serial);
  }
}
