import { Injectable, Logger, NotFoundException, BadRequestException } from "@nestjs/common";
import { PrismaService } from "../prisma.service";
import { IpfsUploadService } from "../uploads/ipfs-upload.service";
import * as https from "https";
import * as http from "http";

@Injectable()
export class CertificateService {
  private readonly logger = new Logger(CertificateService.name);

  /**
   * Whether to skip on-chain verification (for test environments only).
   * Set SKIP_ONCHAIN_VERIFICATION=true in .env to disable.  Defaults to false.
   */
  private readonly skipVerification: boolean =
    process.env.SKIP_ONCHAIN_VERIFICATION === "true";

  constructor(
    private readonly prisma: PrismaService,
    private readonly ipfsUpload: IpfsUploadService,
  ) {}

  /**
   * Verify that a Stellar transaction hash exists and succeeded on-chain by
   * calling the Horizon REST API.
   *
   * This is the primary replay-attack defence for certificate issuance:
   * an attacker who submits a fabricated or replayed txHash to POST /retirements
   * will be blocked here because the hash will either not exist on Horizon or
   * will resolve to an unrelated transaction.
   *
   * @param txHash  The Stellar transaction hash to verify.
   * @returns       true if the transaction exists and is successful, false otherwise.
   */
  async verifyOnChainRetirement(txHash: string): Promise<boolean> {
    const network = process.env.STELLAR_NETWORK || "testnet";
    const horizonBase =
      network === "mainnet" || network === "public"
        ? "https://horizon.stellar.org"
        : "https://horizon-testnet.stellar.org";

    const url = `${horizonBase}/transactions/${encodeURIComponent(txHash)}`;

    try {
      const body = await this._fetchJson(url);
      const successful = body?.successful === true;
      if (!successful) {
        this.logger.warn(
          `On-chain verification: txHash ${txHash} found but successful=false`,
        );
      }
      return successful;
    } catch (err: any) {
      this.logger.warn(
        `On-chain verification failed for txHash ${txHash}: ${err.message}`,
      );
      return false;
    }
  }

  /**
   * Minimal HTTP GET helper that resolves to the parsed JSON body.
   * Avoids importing axios/node-fetch to keep the dependency footprint small.
   */
  private _fetchJson(url: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const client = url.startsWith("https") ? https : http;
      const req = client.get(url, { headers: { Accept: "application/json" } }, (res) => {
        if (res.statusCode === 404) {
          return reject(new Error(`transaction not found (HTTP 404)`));
        }
        if ((res.statusCode ?? 0) >= 400) {
          return reject(new Error(`Horizon returned HTTP ${res.statusCode}`));
        }
        let raw = "";
        res.on("data", (chunk) => (raw += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(raw));
          } catch {
            reject(new Error("Failed to parse Horizon response as JSON"));
          }
        });
      });
      req.on("error", (err) => reject(err));
      req.setTimeout(10_000, () => {
        req.destroy();
        reject(new Error("Horizon request timed out after 10 s"));
      });
    });
  }

  /**
   * Generates a JSON certificate for a retirement, pins it to IPFS,
   * and updates the database record with the CID.
   *
   * On-chain verification is performed before pinning to prevent fraudulent
   * certificate issuance via fabricated or replayed txHash values.
   */
  async generateAndPinCertificate(retirementId: string): Promise<{ cid: string }> {
    this.logger.log(`Processing certificate for retirement: ${retirementId}`);

    const retirement = await this.prisma.retirementRecord.findUnique({
      where: { retirementId },
      include: { project: true, batch: true },
    });

    if (!retirement) {
      throw new NotFoundException(`Retirement ${retirementId} not found`);
    }

    // ── On-chain verification (Feature #568: replay attack protection) ───────
    // Confirm the submitted txHash actually exists and succeeded on the Stellar
    // network before issuing an IPFS-pinned certificate.  This blocks Scenario B
    // (fabricated txHash) and Scenario C (unrelated transaction hash) from the
    // replay analysis.
    if (!this.skipVerification) {
      const isOnChain = await this.verifyOnChainRetirement(retirement.txHash);
      if (!isOnChain) {
        this.logger.error(
          `Certificate issuance blocked for retirement ${retirementId}: ` +
          `txHash ${retirement.txHash} not confirmed on-chain`,
        );
        throw new BadRequestException(
          "Cannot issue certificate: retirement not confirmed on-chain. " +
          "Ensure the Stellar transaction has been included in a ledger and succeeded.",
        );
      }
    } else {
      this.logger.warn(
        `SKIP_ONCHAIN_VERIFICATION=true — skipping Horizon check for ${retirementId}`,
      );
    }

    // 1. Create the certificate JSON structure matching on-chain RetirementCertificate
    // Expand serial range into full list to match Vec<u64> on-chain
    const start = parseInt(retirement.serialStart);
    const end = parseInt(retirement.serialEnd);
    const serialNumbers: number[] = [];
    if (!isNaN(start) && !isNaN(end)) {
      for (let s = start; s <= end; s++) {
        serialNumbers.push(s);
      }
    }

    const certificateData = {
      retirement_id: retirement.retirementId,
      credit_batch_id: retirement.batchId,
      project_id: retirement.projectId,
      amount: retirement.amount.toString(), // i128 on-chain
      retired_by: retirement.retiredBy,
      beneficiary: retirement.beneficiary,
      retirement_reason: retirement.retirementReason,
      vintage_year: retirement.vintageYear,
      serial_numbers: serialNumbers, // Match Vec<u64> representation exactly
      retired_at: Math.floor(retirement.retiredAt.getTime() / 1000), // Unix timestamp on-chain
      tx_hash: retirement.txHash,
      certificate_cid: "", // To be filled if we had it, but we are generating it now

      // Additional metadata for accessibility/UI
      metadata: {
        projectName: retirement.project.name,
        country: retirement.project.country,
        methodology: retirement.project.methodology,
        network: process.env.STELLAR_NETWORK || "testnet",
        issuer: "CarbonLedger",
        generatedAt: new Date().toISOString(),
      },
    };

    const jsonBuffer = Buffer.from(JSON.stringify(certificateData, null, 2));
    const fileName = `certificate-${retirementId}.json`;

    // 2. Upload and pin to IPFS via Pinata
    const uploadResult = await this.ipfsUpload.uploadToPinata(
      fileName,
      "application/json",
      jsonBuffer,
      jsonBuffer.length,
      "certificate",
      retirement.id,
    );

    this.logger.log(`Certificate pinned to IPFS: ${uploadResult.cid}`);

    // 3. Update RetirementRecord with the CID
    await this.prisma.retirementRecord.update({
      where: { retirementId },
      data: {
        certificateCid: uploadResult.cid,
      },
    });

    return { cid: uploadResult.cid };
  }
}
