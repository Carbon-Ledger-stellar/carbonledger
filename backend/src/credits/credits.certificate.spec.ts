import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { CreditsService } from './credits.service';
import { PrismaService } from '../prisma.service';
import { MailService } from '../mail/mail.service';
import { IpfsService } from '../common/ipfs.service';
import { CertificateService } from '../certificates/certificate.service';
import { QueueService } from '../queue/queue.service';

/**
 * Unit tests for CreditsService#getCertificate (issue #1016).
 *
 * These tests cover:
 *  1. Returns a PDF buffer for a valid retirement with no prior certificate.
 *  2. Returns 404 for an unknown retirementId.
 *  3. Returns certificateUrl (no PDF) when the certificate already exists.
 */
describe('CreditsService – getCertificate (#1016)', () => {
  let service: CreditsService;
  let prisma: jest.Mocked<PrismaService>;
  let certSvc: jest.Mocked<CertificateService>;

  const mockProject = {
    id: 'proj-1',
    projectId: 'proj-1',
    name: 'Amazon Reforestation',
    country: 'BR',
    methodology: 'REDD+',
  };

  const mockBatch = {
    id: 'batch-1',
    batchId: 'batch-1',
    projectId: 'proj-1',
    vintageYear: 2023,
    serialStart: '1000',
    serialEnd: '2000',
    amount: 10,
  };

  const baseRetirement = {
    id: 'record-uuid-1',
    retirementId: 'ret-batch-1-1234',
    batchId: 'batch-1',
    projectId: 'proj-1',
    amount: 10,
    retiredBy: 'GABC123',
    beneficiary: 'Acme Corp',
    retirementReason: 'Annual ESG offset',
    vintageYear: 2023,
    serialStart: '1000',
    serialEnd: '1099',
    serialNumbers: ['1000', '1001'],
    txHash: 'abc123txhash',
    certificateCid: null,
    certificateUrl: null,
    certificateContentCid: null,
    certificateContentHash: null,
    certificateStatus: 'pending_certificate',
    certificateRetries: 0,
    certificateFailedAt: null,
    certificateGeneratedAt: null,
    legacyStatus: null,
    isValid: true,
    validatedAt: null,
    retiredAt: new Date('2024-01-15T00:00:00Z'),
    deletedAt: null,
    project: mockProject,
    batch: mockBatch,
  };

  beforeEach(async () => {
    const prismaMock = {
      retirementRecord: {
        findFirst: jest.fn(),
        update: jest.fn(),
      },
    };

    const certSvcMock = {
      generatePdf: jest.fn(),
    };

    const mailMock = { sendIfEnabled: jest.fn() };
    const ipfsMock = {};

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CreditsService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: MailService, useValue: mailMock },
        { provide: IpfsService, useValue: ipfsMock },
        { provide: CertificateService, useValue: certSvcMock },
        { provide: QueueService, useValue: { add: jest.fn() } },
      ],
    }).compile();

    service = module.get<CreditsService>(CreditsService);
    prisma = module.get(PrismaService);
    certSvc = module.get(CertificateService);
  });

  // ── Test 1: Returns PDF buffer for a valid retirement ──────────────────

  it('returns a PDF buffer and stores certificateUrl for a valid retirement', async () => {
    const fakePdf = Buffer.from('%PDF-1.4 fake');
    (prisma.retirementRecord.findFirst as jest.Mock).mockResolvedValue(baseRetirement);
    (prisma.retirementRecord.update as jest.Mock).mockResolvedValue({
      ...baseRetirement,
      certificateUrl: `https://carbonledger.io/certificates/${baseRetirement.retirementId}`,
      certificateStatus: 'generated',
    });
    certSvc.generatePdf.mockResolvedValue(fakePdf);

    const result = await service.getCertificate(baseRetirement.retirementId);

    expect(result.pdfBuffer).toBe(fakePdf);
    expect(result.certificateUrl).toBe(
      `https://carbonledger.io/certificates/${baseRetirement.retirementId}`,
    );

    // Verify generatePdf was called with correct data
    expect(certSvc.generatePdf).toHaveBeenCalledWith(
      expect.objectContaining({
        retirementId: baseRetirement.retirementId,
        beneficiary: baseRetirement.beneficiary,
        amount: Number(baseRetirement.amount),
        projectName: mockProject.name,
        retirementReason: baseRetirement.retirementReason,
        vintageYear: baseRetirement.vintageYear,
        txHash: baseRetirement.txHash,
      }),
    );

    // Verify the DB was updated with the certificate URL
    expect(prisma.retirementRecord.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: baseRetirement.id },
        data: expect.objectContaining({
          certificateUrl: `https://carbonledger.io/certificates/${baseRetirement.retirementId}`,
          certificateStatus: 'generated',
        }),
      }),
    );
  });

  // ── Test 2: Returns 404 for unknown retirementId ───────────────────────

  it('throws NotFoundException for an unknown retirementId', async () => {
    (prisma.retirementRecord.findFirst as jest.Mock).mockResolvedValue(null);

    await expect(service.getCertificate('nonexistent-id')).rejects.toThrow(
      NotFoundException,
    );
    await expect(service.getCertificate('nonexistent-id')).rejects.toThrow(
      'Retirement record nonexistent-id not found',
    );

    // PDF generation must not be attempted
    expect(certSvc.generatePdf).not.toHaveBeenCalled();
  });

  // ── Test 3: Returns certificateUrl when certificate already exists ─────

  it('returns existing certificateUrl without regenerating the PDF', async () => {
    const existingUrl = `https://carbonledger.io/certificates/${baseRetirement.retirementId}`;
    const retirementWithCert = {
      ...baseRetirement,
      certificateUrl: existingUrl,
      certificateStatus: 'generated',
      certificateGeneratedAt: new Date(),
    };

    (prisma.retirementRecord.findFirst as jest.Mock).mockResolvedValue(retirementWithCert);

    const result = await service.getCertificate(baseRetirement.retirementId);

    expect(result.certificateUrl).toBe(existingUrl);
    expect(result.pdfBuffer).toBeUndefined();

    // PDF must not be regenerated
    expect(certSvc.generatePdf).not.toHaveBeenCalled();
    // DB must not be updated again
    expect(prisma.retirementRecord.update).not.toHaveBeenCalled();
  });

  // ── Test 4: Returns URL-only when CertificateService unavailable ───────

  it('returns certificateUrl only when CertificateService is not injected', async () => {
    // Simulate no CertificateService by creating a service without it
    const prismaMock = {
      retirementRecord: {
        findFirst: jest.fn().mockResolvedValue(baseRetirement),
        update: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CreditsService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: MailService, useValue: { sendIfEnabled: jest.fn() } },
        { provide: IpfsService, useValue: {} },
        { provide: QueueService, useValue: { add: jest.fn() } },
        // CertificateService intentionally omitted — @Optional() means no throw
      ],
    }).compile();

    const svcNoCert = module.get<CreditsService>(CreditsService);
    const result = await svcNoCert.getCertificate(baseRetirement.retirementId);

    expect(result.pdfBuffer).toBeUndefined();
    expect(result.certificateUrl).toBe(
      `https://carbonledger.io/certificates/${baseRetirement.retirementId}`,
    );
  });
});
