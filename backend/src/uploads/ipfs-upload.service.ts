import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma.service";
import axios from "axios";
import FormData from "form-data";

@Injectable()
export class IpfsUploadService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Upload file to Pinata and store file record in database
   * Returns CID immediately while pinning happens asynchronously
   */
  async uploadToPinata(
    fileName: string,
    fileType: string,
    fileBuffer: Buffer,
    fileSize: number,
    linkedEntityType?: string,
    linkedEntityId?: string
  ): Promise<{ id: string; cid: string; pinStatus: string }> {
    // Validate file type
    const allowedTypes = ["application/pdf", "application/json"];
    if (!allowedTypes.includes(fileType)) {
      throw new Error(
        `Invalid file type: ${fileType}. Only PDF and JSON files are allowed.`
      );
    }

    // Validate file size (50MB limit)
    const maxSize = 52428800; // 50MB in bytes
    if (fileSize > maxSize) {
      throw new Error(
        `File size ${fileSize} bytes exceeds maximum allowed size of ${maxSize} bytes (50MB)`
      );
    }

    const pinataApiUrl = process.env.IPFS_API_URL || "https://api.pinata.cloud";
    const pinataApiKey = process.env.IPFS_API_KEY;
    const pinataSecretKey = process.env.IPFS_SECRET_KEY;

    if (!pinataApiKey || !pinataSecretKey) {
      throw new Error("Pinata API credentials not configured");
    }

    // Create file record in DB with pending status before upload
    const fileRecord = await this.prisma.iPFSFile.create({
      data: {
        cid: "", // Will be updated after upload
        fileName,
        fileType,
        fileSize,
        pinStatus: "pending",
        linkedEntityType,
        linkedEntityId,
      },
    });

    try {
      // Prepare form data for Pinata upload
      const formData = new FormData();
      formData.append("file", fileBuffer, {
        filename: fileName,
        contentType: fileType,
      });

      // Upload to Pinata
      const uploadResponse = await axios.post(
        `${pinataApiUrl}/pinning/pinFileToIPFS`,
        formData,
        {
          maxBodyLength: Infinity,
          maxContentLength: Infinity,
          headers: {
            ...formData.getHeaders(),
            pinata_api_key: pinataApiKey,
            pinata_secret_api_key: pinataSecretKey,
          },
        }
      );

      const cid = uploadResponse.data.IpfsHash;

      // Update file record with CID
      await this.prisma.iPFSFile.update({
        where: { id: fileRecord.id },
        data: { cid },
      });

      // Trigger async pin operation (fire and forget)
      this.pinFileAsync(cid, fileRecord.id);

      return {
        id: fileRecord.id,
        cid,
        pinStatus: "pending",
      };
    } catch (error: any) {
      // Update file record with failed status
      await this.prisma.iPFSFile.update({
        where: { id: fileRecord.id },
        data: { pinStatus: "failed" },
      });

      throw new Error(
        `Pinata upload failed: ${error?.message || "Unknown error"}`
      );
    }
  }

  /**
   * Asynchronously pin a file on Pinata
   * Updates pin status in database
   */
  private async pinFileAsync(fileId: string, dbRecordId: string): Promise<void> {
    try {
      const pinataApiUrl = process.env.IPFS_API_URL || "https://api.pinata.cloud";
      const pinataApiKey = process.env.IPFS_API_KEY;
      const pinataSecretKey = process.env.IPFS_SECRET_KEY;

      if (!pinataApiKey || !pinataSecretKey) {
        throw new Error("Pinata API credentials not configured");
      }

      // Get the file record to obtain CID
      const fileRecord = await this.prisma.iPFSFile.findFirst({
        where: { id: dbRecordId },
      });

      if (!fileRecord || !fileRecord.cid) {
        throw new Error("File record not found or CID not available");
      }

      // Pin the file on Pinata
      await axios.post(
        `${pinataApiUrl}/pinning/pinByHash`,
        {
          hashToPin: fileRecord.cid,
          pinataMetadata: {
            name: fileRecord.fileName,
            keyvalues: {
              fileType: fileRecord.fileType,
              fileSize: fileRecord.fileSize,
              linkedEntityType: fileRecord.linkedEntityType || "",
              linkedEntityId: fileRecord.linkedEntityId || "",
            },
          },
        },
        {
          headers: {
            "Content-Type": "application/json",
            pinata_api_key: pinataApiKey,
            pinata_secret_api_key: pinataSecretKey,
          },
        }
      );

      // Update pin status to pinned
      await this.prisma.iPFSFile.update({
        where: { id: dbRecordId },
        data: {
          pinStatus: "pinned",
          pinnedAt: new Date(),
        },
      });
    } catch (error: any) {
      // Update pin status to failed
      await this.prisma.iPFSFile.update({
        where: { id: dbRecordId },
        data: { pinStatus: "failed" },
      });

      console.error(
        `Async pin failed for file ${dbRecordId}: ${error?.message || "Unknown error"}`
      );
    }
  }

  /**
   * Handle Pinata webhook updates for pin status
   */
  async handlePinataWebhook(data: any): Promise<void> {
    const { id, status, pinataApiError } = data;

    if (!id) {
      throw new Error("Webhook missing file ID");
    }

    let pinStatus = "pending";
    if (status === "pinned") {
      pinStatus = "pinned";
    } else if (status === "failed" || pinataApiError) {
      pinStatus = "failed";
    }

    // Update file record with webhook status
    await this.prisma.iPFSFile.update({
      where: { id },
      data: {
        pinStatus,
        pinnedAt: status === "pinned" ? new Date() : undefined,
      },
    });
  }

  /**
   * Get file by CID
   */
  async getFileByCid(cid: string) {
    return this.prisma.iPFSFile.findFirst({
      where: { cid },
    });
  }

  /**
   * Get all files with optional filters
   */
  async getFiles(filters: {
    pinStatus?: string;
    linkedEntityType?: string;
    linkedEntityId?: string;
  }) {
    return this.prisma.iPFSFile.findMany({
      where: {
        ...(filters.pinStatus && { pinStatus: filters.pinStatus }),
        ...(filters.linkedEntityType && {
          linkedEntityType: filters.linkedEntityType,
        }),
        ...(filters.linkedEntityId && {
          linkedEntityId: filters.linkedEntityId,
        }),
      },
      orderBy: { uploadedAt: "desc" },
    });
  }
}