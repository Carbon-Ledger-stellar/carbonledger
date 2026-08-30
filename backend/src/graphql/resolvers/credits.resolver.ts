import { Resolver, Query, Args, Context, Mutation } from '@nestjs/graphql';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { GraphQLJSON } from 'graphql-type-json';
import { CreditBatchType, SerialProvenanceType } from '../types/credit.type';
import { ListCreditsInput, MintCreditsInput, RetireCreditsInput } from '../types/marketplace.type';
import { CreditsService } from '../../credits/credits.service';
import { Public } from '../../auth/decorators';

@Resolver(() => CreditBatchType)
export class CreditsResolver {
  constructor(private readonly creditsService: CreditsService) {}

  private requireRole(ctx: { req?: { user?: { publicKey: string; role: string } } }, roles: string[]) {
    const user = ctx.req?.user;
    if (!user) throw new UnauthorizedException('Authentication required');
    if (!roles.includes(user.role)) throw new ForbiddenException('Insufficient permissions');
    return user;
  }

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

  @Query(() => [CreditBatchType], { name: 'listCredits' })
  @Public()
  listCredits(@Args('input') input: ListCreditsInput) {
    return this.creditsService.getBatchesByProject(input.projectId);
  }

  @Mutation(() => GraphQLJSON, { name: 'mintCredits' })
  async mintCredits(@Args('input') input: MintCreditsInput, @Context() ctx: any) {
    const user = this.requireRole(ctx, ['admin']);
    return this.creditsService.mintCredits(input as any, user.publicKey);
  }

  @Mutation(() => GraphQLJSON, { name: 'retireCredits' })
  async retireCredits(@Args('input') input: RetireCreditsInput, @Context() ctx: any) {
    const user = this.requireRole(ctx, ['corporation', 'admin']);
    return this.creditsService.retireCredits({ ...input, holderPublicKey: user.publicKey });
  }
}
