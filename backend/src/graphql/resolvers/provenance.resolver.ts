import { Resolver, Query, Args } from '@nestjs/graphql';
import { Public } from '../../auth/decorators';
import { CreditsService } from '../../credits/credits.service';
import { CreditBatchProvenanceType, SerialProvenanceType } from '../types/credit.type';

@Resolver(() => CreditBatchProvenanceType)
export class ProvenanceResolver {
  constructor(private readonly creditsService: CreditsService) {}

  @Query(() => SerialProvenanceType, { name: 'serialProvenanceDetailed' })
  @Public()
  getSerialProvenanceDetailed(@Args('serial') serial: string) {
    return this.creditsService.getSerialProvenance(serial);
  }

  @Query(() => CreditBatchProvenanceType, { name: 'creditBatchProvenance' })
  @Public()
  async getCreditBatchProvenance(@Args('batchId') batchId: string) {
    const batch = await this.creditsService.getBatch(batchId);
    const provenance = await this.creditsService.getSerialProvenance(batch.serialStart);
    return {
      batchId: batch.batchId,
      project: {
        projectId: provenance.project.projectId,
        name: provenance.project.name,
        methodology: provenance.project.methodology,
        country: provenance.project.country,
        vintageYear: provenance.project.vintageYear,
      },
      transfers: provenance.transfers,
      provenance: provenance.provenance,
      retirement: provenance.retirement,
    };
  }
}
