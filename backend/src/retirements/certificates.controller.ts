import { Controller, Get, Param, NotFoundException } from "@nestjs/common";
import { RetirementsService } from "./retirements.service";
import { Public } from "../auth/decorators";

@Controller("certificates")
export class CertificatesController {
  constructor(private readonly retirementsService: RetirementsService) {}

  /**
   * Public endpoint to retrieve certificate metadata by retirement ID.
   * Required for external audits and transparency.
   */
  @Get(":id")
  @Public()
  async getCertificate(@Param("id") id: string) {
    const r = await this.retirementsService.findOne(id);
    
    return {
      retirementId: r.retirementId,
      amount: r.amount.toString(),
      retiredBy: r.retiredBy,
      beneficiary: r.beneficiary,
      retirementReason: r.retirementReason,
      vintageYear: r.vintageYear,
      serialNumbers: r.serialNumbers,
      txHash: r.txHash,
      retiredAt: r.retiredAt,
      projectId: r.projectId,
      batchId: r.batchId,
      certificateCid: r.certificateCid,
      isValid: r.isValid,
      validatedAt: r.validatedAt,
      ipfsUrl: r.certificateCid 
        ? `https://gateway.pinata.cloud/ipfs/${r.certificateCid}`
        : null,
      project: {
        name: r.project.name,
        country: r.project.country,
        methodology: r.project.methodology,
      }
    };
  }
}
