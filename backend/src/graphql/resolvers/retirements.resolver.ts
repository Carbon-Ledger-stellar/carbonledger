import { Resolver, Query, Args, Int, Context } from '@nestjs/graphql';
import { UnauthorizedException } from '@nestjs/common';
import { RetirementType, RetirementsPage } from '../types/retirement.type';
import { RetirementsService } from '../../retirements/retirements.service';
import { Public } from '../../auth/decorators';

@Resolver(() => RetirementType)
export class RetirementsResolver {
  constructor(private readonly retirementsService: RetirementsService) {}

  /**
   * Paginated list of retirements scoped to the authenticated caller.
   * Mirrors GET /retirements — requires a valid JWT.
   */
  @Query(() => RetirementsPage, { name: 'retirements' })
  async getRetirements(
    @Context() ctx: { req: any },
    @Args('cursor', { nullable: true }) cursor?: string,
    @Args('limit',  { nullable: true, type: () => Int, defaultValue: 20 }) limit?: number,
  ) {
    const user = ctx.req?.user;
    if (!user) throw new UnauthorizedException('Authentication required');
    return this.retirementsService.findAll(cursor, limit ?? 20, user.publicKey);
  }

  /**
   * Single retirement certificate — public, mirrors GET /retirements/:id/certificate.
   * Returns the full provenance view needed by the audit explorer in one query.
   */
  @Query(() => RetirementType, { name: 'retirementCertificate' })
  @Public()
  async getRetirementCertificate(@Args('retirementId') retirementId: string) {
    const r = await this.retirementsService.findOne(retirementId);
    return {
      ...r,
      amount:         r.amount?.toString(),
      certificateUrl: r.certificateCid
        ? `https://gateway.pinata.cloud/ipfs/${r.certificateCid}`
        : null,
    };
  }
}
