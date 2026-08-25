import { createHash } from 'crypto';
import { CertificateProcessor } from './certificate.processor';
import { CertificateService } from './certificate.service';
import { PinataService } from './pinata.service';
import { NotificationService } from './notification.service';

const mockRetirement = {
  id: 'cuid-001',
  retirementId: 'ret-001',
  projectId: 'PROJ001',
  batchId: 'BATCH001',
  beneficiary: 'Acme Corp',
  amount: 100,
  retirementReason: 'Q1 offset',
  retiredAt: new Date('2026-01-01T00:00:00Z'),
  serialNumbers: [],
  serialStart: '1',
  serialEnd: '100',
  vintageYear: 2023,
  txHash: 'TX_HASH_1',
  retiredBy: 'WALLET_A',
  certificateRetries: 0,
  project: { name: 'Amazon Reforestation', country: 'Brazil', methodology: 'VCS' },
};

describe('CertificateProcessor — content pinning + self-referential CID (#600)', () => {
  let processor: CertificateProcessor;
  let prismaMock: any;
  let certificateServiceMock: jest.Mocked<Pick<CertificateService, 'generatePdf'>>;
  let pinataServiceMock: jest.Mocked<Pick<PinataService, 'uploadFile'>>;
  let notificationServiceMock: jest.Mocked<
    Pick<NotificationService, 'sendCertificateReady' | 'sendCertificateFailed'>
  >;
  let certificateSigningMock: { sign: jest.Mock };

  beforeEach(() => {
    prismaMock = {
      retirementRecord: {
        findUnique: jest.fn().mockResolvedValue(mockRetirement),
        update: jest.fn().mockResolvedValue(mockRetirement),
      },
      retirementCertificate: {
        create: jest.fn().mockResolvedValue({}),
      },
    };
    certificateServiceMock = { generatePdf: jest.fn().mockResolvedValue(Buffer.from('pdf')) };
    pinataServiceMock = {
      uploadFile: jest
        .fn()
        .mockResolvedValueOnce({ cid: 'QmContentCid1', url: 'https://ipfs.example/QmContentCid1' })
        .mockResolvedValueOnce({ cid: 'QmPdfCid1', url: 'https://ipfs.example/QmPdfCid1' }),
    };
    notificationServiceMock = {
      sendCertificateReady: jest.fn().mockResolvedValue(undefined),
      sendCertificateFailed: jest.fn().mockResolvedValue(undefined),
    };
    certificateSigningMock = {
      sign: jest.fn().mockReturnValue({
        contentHash: 'mock-signing-content-hash',
        signature: 'mock-signature',
        publicKey: 'mock-public-key',
      }),
    };

    processor = new CertificateProcessor(
      prismaMock,
      certificateServiceMock as any,
      pinataServiceMock as any,
      notificationServiceMock as any,
      certificateSigningMock as any,
    );
  });

  it('pins the certificate content to IPFS before generating the PDF', async () => {
    await processor.processCertificateGeneration('ret-001');

    // First uploadFile call is the JSON content, with the correct MIME type.
    const [firstCallArgs] = pinataServiceMock.uploadFile.mock.calls;
    expect(firstCallArgs[1]).toBe('certificate-ret-001.json');
    expect(firstCallArgs[3]).toBe('application/json');
  });

  it('passes the content CID into PDF generation for self-referential embedding', async () => {
    await processor.processCertificateGeneration('ret-001');

    expect(certificateServiceMock.generatePdf).toHaveBeenCalledWith(
      expect.objectContaining({ contentCid: 'QmContentCid1' }),
    );
  });

  it('persists both the PDF CID and the content CID/hash on the retirement record', async () => {
    await processor.processCertificateGeneration('ret-001');

    expect(prismaMock.retirementRecord.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { retirementId: 'ret-001' },
        data: expect.objectContaining({
          certificateCid: 'QmPdfCid1',
          certificateContentCid: 'QmContentCid1',
          certificateContentHash: expect.any(String),
        }),
      }),
    );
  });

  it('records a content hash that matches the exact bytes that were pinned', async () => {
    await processor.processCertificateGeneration('ret-001');

    const pinnedBuffer: Buffer = pinataServiceMock.uploadFile.mock.calls[0][0];
    const expectedHash = createHash('sha256').update(pinnedBuffer).digest('hex');

    const updateCall = prismaMock.retirementRecord.update.mock.calls.find(
      (call: any) => call[0].data.certificateContentHash,
    );
    expect(updateCall[0].data.certificateContentHash).toBe(expectedHash);
  });
});
