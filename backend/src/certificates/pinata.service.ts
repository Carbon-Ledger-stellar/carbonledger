import { Injectable, Logger } from '@nestjs/common';
import { PinataSDK } from 'pinata';

interface PinataUploadResult {
  cid: string;
  url: string;
}

@Injectable()
export class PinataService {
  private readonly logger = new Logger(PinataService.name);
  private pinata: PinataSDK;

  private readonly gateway: string;

  constructor() {
    // pinata v2 authenticates with a JWT; the v1 apiKey/secret pair is gone.
    const jwt = process.env.IPFS_JWT;
    this.gateway = process.env.IPFS_GATEWAY || 'gateway.pinata.cloud';

    if (!jwt) {
      this.logger.warn('Pinata credentials not configured (IPFS_JWT unset)');
    }

    this.pinata = new PinataSDK({
      pinataJwt: jwt,
      pinataGateway: this.gateway,
    });
  }

  async uploadFile(
    buffer: Buffer,
    filename: string,
    metadata?: Record<string, unknown>
  ): Promise<PinataUploadResult> {
    try {
      this.logger.log(`Uploading ${filename} to Pinata...`);

      const blob = new Blob([new Uint8Array(buffer)], { type: 'application/pdf' });
      const file = new File([blob], filename, { type: 'application/pdf' });

      const result = await this.pinata.upload.public.file(file);

      const cid = result.cid;
      const url = this.getPublicUrl(cid);

      this.logger.log(`Successfully uploaded ${filename} to IPFS: ${cid}`);

      return { cid, url };
    } catch (error) {
      this.logger.error(`Pinata upload failed: ${error}`, error);
      throw error;
    }
  }

  async verifyPin(cid: string): Promise<boolean> {
    try {
      const result = await this.pinata.files.public.list().cid(cid);

      return result.files.length > 0;
    } catch (error) {
      this.logger.error(`Failed to verify pin ${cid}: ${error}`);
      return false;
    }
  }

  getPublicUrl(cid: string): string {
    return `https://${this.gateway}/ipfs/${cid}`;
  }
}
