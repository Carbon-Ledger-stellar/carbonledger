/**
 * retirement-replay.spec.ts
 *
 * Unit tests for Feature #568: Replay attack protection on the retirement flow.
 *
 * Tests verify:
 *   1. txHash uniqueness check rejects a replayed/reused transaction hash.
 *   2. On-chain verification blocks a fabricated txHash (verifyOnChainRetirement
 *      returns false → certificate issuance throws BadRequestException).
 *   3. On-chain verification passes for a valid txHash (SKIP_ONCHAIN_VERIFICATION
 *      path tested to keep tests deterministic without Horizon access).
 *   4. A replayed retirement attempt with the same txHash from a different wallet
 *      is rejected with ConflictException.
 *
 * NOTE: These are unit tests.  Horizon HTTP calls are mocked so no real network
 * traffic is generated.  Set SKIP_ONCHAIN_VERIFICATION=true in .env.test to
 * bypass on-chain checks in the integration test suite.
 */

import { Test, TestingModule } from "@nestjs/testing";
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { RetirementsService } from "./retirements.service";
import { CertificateService } from "./certificate.service";
import { PrismaService } from "../prisma.service";
import { IpfsService } from "../common/ipfs.service";
import { IpfsUploadService } from "../uploads/ipfs-upload.service";

// ── Prisma mock ───────────────────────────────────────────────────────────────

const mockRetirement = {
  id: "cuid-001",
  retirementId: "ret-001",
  batchId: "BATCH001",
  projectId: "PROJ001",
  amount: 100,
  retiredBy: "WALLET_A",
  beneficiary: "Acme Corp",
  retirementReason: "Q1 emissions offset",
  vintageYear: 2023,
  serialStart: "1",
  serialEnd: "100",
  serialNumbers: [],
  txHash: "TX_REAL_HASH",
  certificateCid: null,
  isValid: true,
  validatedAt: null,
  retiredAt: new Date(),
  project: {
    name: "Amazon Reforestation",
    country: "Brazil",
    methodology: "VCS",
  },
  batch: {
    vintageYear: 2023,
    serialStart: "1",
    serialEnd: "100",
  },
};

const mockBatch = {
  id: "batch-cuid-001",
  batchId: "BATCH001",
  vintageYear: 2023,
  serialStart: "1",
  serialEnd: "100",
  status: "Active",
};

const buildPrismaMock = (overrides: Partial<any> = {}) => ({
  retirementRecord: {
    findFirst: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockResolvedValue(mockRetirement),
    findUnique: jest.fn().mockResolvedValue(mockRetirement),
    update: jest.fn().mockResolvedValue(mockRetirement),
  },
  creditBatch: {
    findUnique: jest.fn().mockResolvedValue(mockBatch),
  },
  ...overrides,
});

// ── IpfsService mock ──────────────────────────────────────────────────────────

const buildIpfsMock = () => ({
  verifyCidMatch: jest.fn().mockReturnValue(true),
});

const buildIpfsUploadMock = () => ({
  uploadToPinata: jest.fn().mockResolvedValue({ cid: "QmFakeCid123" }),
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("RetirementsService — replay attack protection (#568)", () => {
  let service: RetirementsService;
  let prismaMock: ReturnType<typeof buildPrismaMock>;
  let certificateServiceMock: { generateAndPinCertificate: jest.Mock };

  beforeEach(async () => {
    prismaMock = buildPrismaMock();
    certificateServiceMock = {
      generateAndPinCertificate: jest.fn().mockResolvedValue({ cid: "QmFakeCid123" }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RetirementsService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: IpfsService, useValue: buildIpfsMock() },
        { provide: CertificateService, useValue: certificateServiceMock },
      ],
    }).compile();

    service = module.get<RetirementsService>(RetirementsService);
  });

  describe("txHash uniqueness (Scenario A — different wallet, same txHash)", () => {
    it("rejects a retirement when the txHash has already been used", async () => {
      // Simulate txHash already exists in DB (first findFirst call returns a record)
      prismaMock.retirementRecord.findFirst.mockResolvedValueOnce({
        ...mockRetirement,
        retiredBy: "WALLET_B", // different wallet, same txHash
      });

      await expect(
        service.retireCredits({
          batchId:          "BATCH001",
          projectId:        "PROJ001",
          amount:           50,
          retiredBy:        "WALLET_A",
          beneficiary:      "Acme Corp",
          retirementReason: "Test",
          txHash:           "TX_REAL_HASH",
        }),
      ).rejects.toThrow(ConflictException);

      await expect(
        service.retireCredits({
          batchId:          "BATCH001",
          projectId:        "PROJ001",
          amount:           50,
          retiredBy:        "WALLET_A",
          beneficiary:      "Acme Corp",
          retirementReason: "Test",
          txHash:           "TX_REAL_HASH",
        }),
      ).rejects.toThrow("Transaction hash already used");
    });

    it("accepts a retirement when txHash is unique", async () => {
      // Both findFirst calls return null → no duplicate
      prismaMock.retirementRecord.findFirst.mockResolvedValue(null);

      const result = await service.retireCredits({
        batchId:          "BATCH001",
        projectId:        "PROJ001",
        amount:           50,
        retiredBy:        "WALLET_A",
        beneficiary:      "Acme Corp",
        retirementReason: "Test",
        txHash:           "TX_NEW_UNIQUE_HASH",
      });

      expect(result).toHaveProperty("retirementId");
      expect(result.txHash).toBe("TX_NEW_UNIQUE_HASH");
    });

    it("rejects a replayed retirement for the same batchId+retiredBy combination", async () => {
      // First findFirst (txHash check) returns null, second (batchId+retiredBy) returns record
      prismaMock.retirementRecord.findFirst
        .mockResolvedValueOnce(null)              // txHash check: not used
        .mockResolvedValueOnce(mockRetirement);   // batchId+retiredBy: already exists

      await expect(
        service.retireCredits({
          batchId:          "BATCH001",
          projectId:        "PROJ001",
          amount:           50,
          retiredBy:        "WALLET_A",
          beneficiary:      "Acme Corp",
          retirementReason: "Test",
          txHash:           "TX_DIFFERENT_HASH",
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe("batch not found", () => {
    it("throws NotFoundException when batchId does not exist", async () => {
      prismaMock.retirementRecord.findFirst.mockResolvedValue(null);
      prismaMock.creditBatch.findUnique.mockResolvedValue(null);

      await expect(
        service.retireCredits({
          batchId:          "NONEXISTENT",
          projectId:        "PROJ001",
          amount:           50,
          retiredBy:        "WALLET_A",
          beneficiary:      "Acme Corp",
          retirementReason: "Test",
          txHash:           "TX_HASH_NEW",
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });
});

describe("CertificateService — on-chain verification before issuance (#568)", () => {
  let service: CertificateService;
  let prismaMock: ReturnType<typeof buildPrismaMock>;
  let ipfsUploadMock: ReturnType<typeof buildIpfsUploadMock>;

  beforeEach(async () => {
    // Ensure on-chain verification is NOT skipped for these tests.
    delete process.env.SKIP_ONCHAIN_VERIFICATION;

    prismaMock = buildPrismaMock();
    prismaMock.retirementRecord.findUnique.mockResolvedValue(mockRetirement);
    ipfsUploadMock = buildIpfsUploadMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CertificateService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: IpfsUploadService, useValue: ipfsUploadMock },
      ],
    }).compile();

    service = module.get<CertificateService>(CertificateService);
  });

  afterEach(() => {
    delete process.env.SKIP_ONCHAIN_VERIFICATION;
  });

  describe("Scenario B — fabricated txHash blocked", () => {
    it("throws BadRequestException when verifyOnChainRetirement returns false", async () => {
      // Mock Horizon: transaction not found
      jest
        .spyOn(service, "verifyOnChainRetirement")
        .mockResolvedValue(false);

      await expect(
        service.generateAndPinCertificate("ret-001"),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.generateAndPinCertificate("ret-001"),
      ).rejects.toThrow("retirement not confirmed on-chain");

      // IPFS pin must NOT have been called
      expect(ipfsUploadMock.uploadToPinata).not.toHaveBeenCalled();
    });

    it("does not pin to IPFS when on-chain verification fails", async () => {
      jest
        .spyOn(service, "verifyOnChainRetirement")
        .mockResolvedValue(false);

      try {
        await service.generateAndPinCertificate("ret-001");
      } catch {
        // expected
      }

      expect(ipfsUploadMock.uploadToPinata).not.toHaveBeenCalled();
    });
  });

  describe("Scenario A — valid txHash accepted", () => {
    it("issues certificate when on-chain verification passes", async () => {
      jest
        .spyOn(service, "verifyOnChainRetirement")
        .mockResolvedValue(true);

      const result = await service.generateAndPinCertificate("ret-001");

      expect(result.cid).toBe("QmFakeCid123");
      expect(ipfsUploadMock.uploadToPinata).toHaveBeenCalledTimes(1);
    });
  });

  describe("SKIP_ONCHAIN_VERIFICATION flag", () => {
    it("skips Horizon check when SKIP_ONCHAIN_VERIFICATION=true", async () => {
      process.env.SKIP_ONCHAIN_VERIFICATION = "true";

      // Recreate service with env var set
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          CertificateService,
          { provide: PrismaService, useValue: prismaMock },
          { provide: IpfsUploadService, useValue: ipfsUploadMock },
        ],
      }).compile();

      const skipService = module.get<CertificateService>(CertificateService);
      const verifySpy = jest
        .spyOn(skipService, "verifyOnChainRetirement")
        .mockResolvedValue(false); // would normally block

      // Despite false return, certificate should be issued (skip=true)
      const result = await skipService.generateAndPinCertificate("ret-001");

      // verifyOnChainRetirement should NOT be called when skip=true
      expect(verifySpy).not.toHaveBeenCalled();
      expect(result.cid).toBe("QmFakeCid123");
    });
  });

  describe("verifyOnChainRetirement", () => {
    it("returns false when txHash is not found on Horizon (404)", async () => {
      // Use a private-method test by mocking _fetchJson
      (service as any)._fetchJson = jest
        .fn()
        .mockRejectedValue(new Error("transaction not found (HTTP 404)"));

      const result = await service.verifyOnChainRetirement("FAKE_HASH");
      expect(result).toBe(false);
    });

    it("returns true when Horizon responds successful=true", async () => {
      (service as any)._fetchJson = jest
        .fn()
        .mockResolvedValue({ successful: true, id: "TX_HASH" });

      const result = await service.verifyOnChainRetirement("REAL_HASH");
      expect(result).toBe(true);
    });

    it("returns false when Horizon responds successful=false (failed tx)", async () => {
      (service as any)._fetchJson = jest
        .fn()
        .mockResolvedValue({ successful: false, id: "FAILED_TX" });

      const result = await service.verifyOnChainRetirement("FAILED_HASH");
      expect(result).toBe(false);
    });

    it("returns false when Horizon request times out", async () => {
      (service as any)._fetchJson = jest
        .fn()
        .mockRejectedValue(new Error("Horizon request timed out after 10 s"));

      const result = await service.verifyOnChainRetirement("TIMEOUT_HASH");
      expect(result).toBe(false);
    });
  });
});
