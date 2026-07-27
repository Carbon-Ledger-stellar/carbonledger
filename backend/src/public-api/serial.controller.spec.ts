import { Test, TestingModule } from '@nestjs/common';
import { PublicSerialController } from './serial.controller';
import { CreditsService } from '../credits/credits.service';
import { AbuseDetectorGuard } from '../security/abuse.guard';
import { RedisService } from '../redis.service';
import { BadRequestException } from '@nestjs/common';

describe('PublicSerialController', () => {
  let controller: PublicSerialController;
  let creditsServiceMock: any;

  beforeEach(async () => {
    creditsServiceMock = {
      lookupSerial: jest.fn(),
    };

    const redisServiceMock = {
      isConnected: false,
      getClient: jest.fn().mockReturnValue(null),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PublicSerialController],
      providers: [
        { provide: CreditsService, useValue: creditsServiceMock },
        AbuseDetectorGuard,
        { provide: RedisService, useValue: redisServiceMock },
      ],
    }).compile();

    controller = module.get<PublicSerialController>(PublicSerialController);
  });

  describe('lookupSerial', () => {
    it('should return data for a valid serial', async () => {
      creditsServiceMock.lookupSerial.mockResolvedValue({ id: 'test', status: 'active' });
      const result = await controller.lookupSerial('12345');
      expect(result).toEqual({ id: 'test', status: 'active' });
      expect(creditsServiceMock.lookupSerial).toHaveBeenCalledWith('12345');
    });

    it('should throw BadRequestException if serial is missing', async () => {
      await expect(controller.lookupSerial('')).rejects.toThrow(BadRequestException);
    });
  });

  describe('bulkLookup', () => {
    it('should return bulk results mapping fulfilled and rejected', async () => {
      creditsServiceMock.lookupSerial
        .mockResolvedValueOnce({ id: 'test1' })
        .mockRejectedValueOnce(new Error('Not found'));

      const results = await controller.bulkLookup(['101', '102']);
      
      expect(results).toEqual([
        { serial: '101', data: { id: 'test1' } },
        { serial: '102', error: 'Not found' },
      ]);
    });

    it('should throw BadRequestException if array is empty', async () => {
      await expect(controller.bulkLookup([])).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if more than 10 serials', async () => {
      const serials = Array.from({ length: 11 }, (_, i) => String(i));
      await expect(controller.bulkLookup(serials)).rejects.toThrow(BadRequestException);
    });
  });
});
