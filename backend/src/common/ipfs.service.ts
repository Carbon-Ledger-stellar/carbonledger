import { Injectable, Logger } from "@nestjs/common";
import { createHash } from "crypto";

/**
 * IPFS Service for content integrity verification.
 * Verifies that fetched certificate content matches stored CID.
 */
@Injectable()
export class IpfsService {
  private readonly logger = new Logger(IpfsService.name);

  /**
   * Calculate SHA256 hash of content as hex string.
   * Used as basis for CID verification.
   */
  calculateContentHash(content: Buffer | string): string {
    const buffer = typeof content === "string" ? Buffer.from(content, "utf-8") : content;
    return createHash("sha256").update(buffer).digest("hex");
  }

  /**
   * Verify that fetched content matches the stored IPFS CID.
   * Returns true if hashes match, false otherwise.
   * 
   * @param content The fetched certificate content (JSON stringified)
   * @param storedCid The CID stored on-chain during retirement
   * @returns true if content integrity verified, false if mismatch
   */
  verifyCidMatch(content: Buffer | string, storedCid: string): boolean {
    try {
      const contentHash = this.calculateContentHash(content);
      
      // CID format validation and hash extraction
      // For now, we store the SHA256 hash directly as the CID identifier
      // In production, this could use CIDv1 or other IPFS formats
      const cidHash = storedCid.toLowerCase();
      const contentHashLower = contentHash.toLowerCase();

      const matches = cidHash === contentHashLower;
      
      if (!matches) {
        this.logger.warn(
          `CID mismatch detected. Expected: ${cidHash}, Got: ${contentHashLower}`
        );
      }
      
      return matches;
    } catch (error) {
      this.logger.error(`Error verifying CID match: ${error.message}`);
      return false;
    }
  }

  /**
   * Generate IPFS CID for certificate content.
   * Creates a consistent hash that can be stored on-chain.
   * 
   * @param certificateJson Stringified certificate JSON
   * @returns SHA256 hash suitable for IPFS CID storage
   */
  generateCid(certificateJson: string): string {
    return this.calculateContentHash(certificateJson);
  }
}
