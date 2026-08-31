import { NotFoundException, ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { createHash } from 'crypto';
import { CertificatesController } from './certificates.controller';
import { CertificateService } from './certificate.service';
import { PinataService } from './pinata.service';

describe('CertificatesController — GET /certificates/:cid/verify (#600)', () => {
  let controller: CertificatesController;
  let prismaMock: any;
  let pinataServiceMock: jest.Mocked<Pick<PinataService, 'getPublicUrl'>>;
  let fetchSpy: jest.SpyInstance;

  const testCid = 'QmTestCid123';
  const testContent = Buffer.from(JSON.stringify({ retirement_id: 'RET001' }));
  const testHash = createHash('sha256').update(testContent).digest('hex');

  beforeEach(() => {
    prismaMock = {
      retirementRecord: {
        findFirst: jest.fn(),
      },
    };
    pinataServiceMock = {
      getPublicUrl: jest.fn((cid: string) => `https://gateway.pinata.cloud/ipfs/${cid}`),
    };

    controller = new CertificatesController(prismaMock, {} as CertificateService, pinataServiceMock as any);
    fetchSpy = jest.spyOn(global, 'fetch' as any);
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('returns valid=true when fetched content matches the recorded hash (normal retrieval)', async () => {
    prismaMock.retirementRecord.findFirst.mockResolvedValue({
      retirementId: 'RET001',
      certificateContentCid: testCid,
      certificateContentHash: testHash,
    });
    fetchSpy.mockResolvedValue({
      ok: true,
      arrayBuffer: async () => testContent.buffer.slice(testContent.byteOffset, testContent.byteOffset + testContent.byteLength),
    } as Response);

    const result = await controller.verifyByCid(testCid);

    expect(result).toEqual(
      expect.objectContaining({ valid: true, cid: testCid, retirementId: 'RET001', contentHash: testHash }),
    );
  });

  it('throws ConflictException (409) when the fetched content hash does not match (tampered content)', async () => {
    prismaMock.retirementRecord.findFirst.mockResolvedValue({
      retirementId: 'RET001',
      certificateContentCid: testCid,
      certificateContentHash: testHash,
    });
    const tampered = Buffer.from('{"retirement_id":"ATTACKER"}');
    fetchSpy.mockResolvedValue({
      ok: true,
      arrayBuffer: async () => tampered.buffer.slice(tampered.byteOffset, tampered.byteOffset + tampered.byteLength),
    } as Response);

    await expect(controller.verifyByCid(testCid)).rejects.toThrow(ConflictException);
  });

  it('throws NotFoundException (404) when the CID is unknown', async () => {
    prismaMock.retirementRecord.findFirst.mockResolvedValue(null);

    await expect(controller.verifyByCid('QmUnknown')).rejects.toThrow(NotFoundException);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('throws ServiceUnavailableException (503) when IPFS cannot be reached', async () => {
    prismaMock.retirementRecord.findFirst.mockResolvedValue({
      retirementId: 'RET001',
      certificateContentCid: testCid,
      certificateContentHash: testHash,
    });
    fetchSpy.mockRejectedValue(new Error('network unreachable'));

    await expect(controller.verifyByCid(testCid)).rejects.toThrow(ServiceUnavailableException);
  });

  it('throws ServiceUnavailableException (503) when the gateway returns a non-OK status', async () => {
    prismaMock.retirementRecord.findFirst.mockResolvedValue({
      retirementId: 'RET001',
      certificateContentCid: testCid,
      certificateContentHash: testHash,
    });
    fetchSpy.mockResolvedValue({ ok: false, status: 404 } as Response);

    await expect(controller.verifyByCid(testCid)).rejects.toThrow(ServiceUnavailableException);
  });
});
