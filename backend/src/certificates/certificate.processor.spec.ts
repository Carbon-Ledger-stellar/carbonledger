import { CertificateProcessor } from './certificate.processor';
import { CertificateService } from './certificate.service';
import { PinataService } from './pinata.service';
import { NotificationService } from './notification.service';
import { CertificateSigningService } from '../common/certificate-signing.service';

const mockRetirement = {
  id: 'cuid-001',
  retirementId: 'ret-001',
  projectId: 'PROJ001',
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

describe('CertificateProcessor — signing (#594)', () => {
  let processor: CertificateProcessor;
  let prismaMock: any;
  let certificateServiceMock: jest.Mocked<Pick<CertificateService, 'generatePdf'>>;
  let pinataServiceMock: jest.Mocked<Pick<PinataService, 'uploadFile'>>;
  let notificationServiceMock: jest.Mocked<
    Pick<NotificationService, 'sendCertificateReady' | 'sendCertificateFailed'>
  >;
  let certificateSigning: CertificateSigningService;

  beforeEach(() => {
    process.env.CERTIFICATE_SIGNING_SECRET = require('@stellar/stellar-sdk').Keypair.random().secret();
    certificateSigning = new CertificateSigningService();

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
      uploadFile: jest.fn().mockResolvedValue({ cid: 'QmCid1', url: 'https://ipfs.example/QmCid1' }),
    };
    notificationServiceMock = {
      sendCertificateReady: jest.fn().mockResolvedValue(undefined),
      sendCertificateFailed: jest.fn().mockResolvedValue(undefined),
    };

    processor = new CertificateProcessor(
      prismaMock,
      certificateServiceMock as any,
      pinataServiceMock as any,
      notificationServiceMock as any,
      certificateSigning,
    );
  });

  afterEach(() => {
    delete process.env.CERTIFICATE_SIGNING_SECRET;
  });

  it('signs the certificate and passes the signature into PDF generation', async () => {
    await processor.processCertificateGeneration('ret-001');

    expect(certificateServiceMock.generatePdf).toHaveBeenCalledWith(
      expect.objectContaining({
        issuerSignature: expect.any(String),
        issuerPublicKey: certificateSigning.getPublicKey(),
        contentHash: expect.any(String),
      }),
    );
  });

  it('persists the signature fields on the RetirementCertificate row', async () => {
    await processor.processCertificateGeneration('ret-001');

    expect(prismaMock.retirementCertificate.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        issuerSignature: expect.any(String),
        issuerPublicKey: certificateSigning.getPublicKey(),
        contentHash: expect.any(String),
      }),
    });
  });

  it('produces a signature verifiable against the fields shown on the certificate', async () => {
    await processor.processCertificateGeneration('ret-001');

    const [pdfData] = certificateServiceMock.generatePdf.mock.calls[0];
    const signedContent = {
      retirement_id: mockRetirement.retirementId,
      project_id: mockRetirement.projectId,
      beneficiary: mockRetirement.beneficiary,
      amount: mockRetirement.amount.toString(),
      retirement_reason: mockRetirement.retirementReason,
      retired_at: Math.floor(mockRetirement.retiredAt.getTime() / 1000),
      serial_start: mockRetirement.serialStart,
      serial_end: mockRetirement.serialEnd,
      vintage_year: mockRetirement.vintageYear,
      tx_hash: mockRetirement.txHash,
    };

    expect(
      CertificateSigningService.verify(signedContent, pdfData.issuerSignature!, pdfData.issuerPublicKey!),
    ).toBe(true);
  });
});
