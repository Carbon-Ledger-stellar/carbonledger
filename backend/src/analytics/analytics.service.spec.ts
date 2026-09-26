import { Test, TestingModule } from '@nestjs/testing';
import { AnalyticsService } from './analytics.service';
import { AnalyticsEvent } from './analytics.constants';
import axios from 'axios';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('AnalyticsService', () => {
  let service: AnalyticsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AnalyticsService],
    }).compile();

    service = module.get<AnalyticsService>(AnalyticsService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('onModuleInit', () => {
    it('sets provider to none when no env vars set', () => {
      delete process.env.SEGMENT_WRITE_KEY;
      delete process.env.MIXPANEL_TOKEN;
      service.onModuleInit();
      // No error — provider defaults to none
    });

    it('sets provider to segment when SEGMENT_WRITE_KEY is set', () => {
      process.env.SEGMENT_WRITE_KEY = 'test-key';
      service.onModuleInit();
      delete process.env.SEGMENT_WRITE_KEY;
    });

    it('sets provider to mixpanel when MIXPANEL_TOKEN is set', () => {
      process.env.MIXPANEL_TOKEN = 'test-token';
      service.onModuleInit();
      delete process.env.MIXPANEL_TOKEN;
    });
  });

  describe('track', () => {
    it('does not throw when provider is none', () => {
      delete process.env.SEGMENT_WRITE_KEY;
      delete process.env.MIXPANEL_TOKEN;
      service.onModuleInit();
      expect(() =>
        service.track('GTEST', AnalyticsEvent.PURCHASE_COMPLETED, { amount: 10 }),
      ).not.toThrow();
    });

    it('calls Segment API when SEGMENT_WRITE_KEY is configured', async () => {
      process.env.SEGMENT_WRITE_KEY = 'seg-key';
      service.onModuleInit();
      mockedAxios.post.mockResolvedValue({ status: 200 });

      service.track('GPUBKEY', AnalyticsEvent.RETIREMENT_COMPLETED, { amount: 5 });

      // Give the async dispatch a tick to run
      await new Promise((r) => setTimeout(r, 10));

      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://api.segment.io/v1/track',
        expect.objectContaining({ event: AnalyticsEvent.RETIREMENT_COMPLETED }),
        expect.any(Object),
      );
      delete process.env.SEGMENT_WRITE_KEY;
    });

    it('hashes the userId before sending to Segment', async () => {
      process.env.SEGMENT_WRITE_KEY = 'seg-key';
      service.onModuleInit();
      mockedAxios.post.mockResolvedValue({ status: 200 });

      service.track('MY_PUBLIC_KEY', AnalyticsEvent.PAGE_VIEWED, {});
      await new Promise((r) => setTimeout(r, 10));

      const callArgs = mockedAxios.post.mock.calls[0][1] as any;
      // Hashed ID should NOT equal the raw public key
      expect(callArgs.userId).not.toBe('MY_PUBLIC_KEY');
      // Should be a 64-char hex string (SHA-256)
      expect(callArgs.userId).toMatch(/^[a-f0-9]{64}$/);
      delete process.env.SEGMENT_WRITE_KEY;
    });
  });

  describe('identify', () => {
    it('calls Mixpanel engage endpoint when Mixpanel configured', async () => {
      process.env.MIXPANEL_TOKEN = 'mp-token';
      service.onModuleInit();
      mockedAxios.post.mockResolvedValue({ status: 200 });

      service.identify('GPUBKEY', { role: 'corporation' });
      await new Promise((r) => setTimeout(r, 10));

      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://api.mixpanel.com/engage#profile-set',
        expect.arrayContaining([
          expect.objectContaining({ $token: 'mp-token', $set: { role: 'corporation' } }),
        ]),
      );
      delete process.env.MIXPANEL_TOKEN;
    });
  });

  describe('error handling', () => {
    it('does not throw when Segment API returns an error', async () => {
      process.env.SEGMENT_WRITE_KEY = 'seg-key';
      service.onModuleInit();
      mockedAxios.post.mockRejectedValue(new Error('Network error'));

      expect(() =>
        service.track('GPUBKEY', AnalyticsEvent.PURCHASE_COMPLETED, {}),
      ).not.toThrow();
      // Give the async dispatch time to fail silently
      await new Promise((r) => setTimeout(r, 20));
      delete process.env.SEGMENT_WRITE_KEY;
    });
  });
});
