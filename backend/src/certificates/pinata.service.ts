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

  constructor() {
    const apiKey = process.env.IPFS_API_KEY;
    const secretKey = process.env.IPFS_SECRET_KEY;

    if (!apiKey || !secretKey) {
      this.logger.warn('Pinata credentials not configured');
    }

    this.pinata = new PinataSDK({
      pinataApiKey: apiKey,
      pinataSecretApiKey: secretKey,
    });
  }

  async uploadFile(
    buffer: Buffer,
    filename: string,
    metadata?: Record<string, unknown>
  ): Promise<PinataUploadResult> {
    try {
      this.logger.log(`Uploading ${filename} to Pinata...`);

      const blob = new Blob([buffer], { type: 'application/pdf' });
      const file = new File([blob], filename, { type: 'application/pdf' });

      const result = await this.pinata.upload.file(file);

      const cid = result.IpfsHash;
      const url = `https://gateway.pinata.cloud/ipfs/${cid}`;

      this.logger.log(`Successfully uploaded ${filename} to IPFS: ${cid}`);

      return { cid, url };
    } catch (error) {
      this.logger.error(`Pinata upload failed: ${error}`, error);
      throw error;
    }
  }

  async verifyPin(cid: string): Promise<boolean> {
    try {
      const result = await this.pinata.pinList({
        hashContains: cid,
      });

      return result.rows && result.rows.length > 0;
    } catch (error) {
      this.logger.error(`Failed to verify pin ${cid}: ${error}`);
      return false;
    }
  }

  getPublicUrl(cid: string): string {
    return `https://gateway.pinata.cloud/ipfs/${cid}`;
  }
}
