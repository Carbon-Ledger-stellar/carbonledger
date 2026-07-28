import { Injectable, Logger } from '@nestjs/common';
import { uploadFile } from 'pinata';

interface PinataUploadResult {
  cid: string;
  url: string;
}

/**
 * Pinata config interface matching the SDK requirements.
 */
interface PinataSdkConfig {
  pinataJwt?: string;
}

@Injectable()
export class PinataService {
  private readonly logger = new Logger(PinataService.name);
  private readonly config: PinataSdkConfig;

  constructor() {
    const jwt = process.env.PINATA_JWT;
    const apiKey = process.env.IPFS_API_KEY;
    const secretKey = process.env.IPFS_SECRET_KEY;

    if (jwt) {
      this.config = { pinataJwt: jwt };
    } else if (apiKey && secretKey) {
      // Pinata v2 SDK no longer supports apiKey/secretKey directly;
      // users should migrate to PINATA_JWT. Fallback by building a JWT string.
      this.config = { pinataJwt: `${apiKey}:${secretKey}` };
    } else {
      this.config = {};
      this.logger.warn(
        'Pinata not configured. Set PINATA_JWT (or IPFS_API_KEY + IPFS_SECRET_KEY).',
      );
    }
  }

  async uploadFile(
    buffer: Buffer,
    filename: string,
    metadata?: Record<string, unknown>,
  ): Promise<PinataUploadResult> {
    try {
      this.logger.log(`Uploading ${filename} to Pinata...`);

      const blob = new Blob([new Uint8Array(buffer)], {
        type: 'application/pdf',
      });
      const file = new File([blob], filename, { type: 'application/pdf' });

      const result = await uploadFile(this.config, file, 'public', undefined);

      // Pinata v2 uploadFile returns { IpfsHash, PinSize, Timestamp }
      const cid = (result as any).IpfsHash ?? (result as any).cid;
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
      // In Pinata v2 SDK the verify method is not directly exposed;
      // we check existence by fetching the gateway URL.
      const response = await fetch(
        `https://gateway.pinata.cloud/ipfs/${cid}`,
        { method: 'HEAD' },
      );
      return response.ok;
    } catch (error) {
      this.logger.error(`Failed to verify pin ${cid}: ${error}`);
      return false;
    }
  }

  getPublicUrl(cid: string): string {
    return `https://gateway.pinata.cloud/ipfs/${cid}`;
  }
}
