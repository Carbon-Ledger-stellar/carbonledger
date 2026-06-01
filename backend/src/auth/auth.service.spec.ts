import { Test, TestingModule } from '@nestjs/testing';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import * as StellarSdk from '@stellar/stellar-sdk';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma.service';

const TEST_SECRET = 'test-secret';

// Minimal PrismaService mock
const prismaMock = {
  user: {
    upsert: jest.fn(),
    findUnique: jest.fn(),
  },
};

describe('AuthService', () => {
  let service: AuthService;
  let jwtService: JwtService;
  let keypair: StellarSdk.Keypair;

  beforeEach(async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    process.env.JWT_REFRESH_SECRET = TEST_SECRET;

    const module: TestingModule = await Test.createTestingModule({
      imports: [JwtModule.register({ secret: TEST_SECRET, signOptions: { expiresIn: '15m' } })],
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    service = module.get(AuthService);
    jwtService = module.get(JwtService);
    keypair = StellarSdk.Keypair.random();

    prismaMock.user.upsert.mockResolvedValue({
      publicKey: keypair.publicKey(),
      role: 'corporation',
    });
    prismaMock.user.findUnique.mockResolvedValue({
      publicKey: keypair.publicKey(),
      role: 'corporation',
    });
  });

  afterEach(() => jest.clearAllMocks());

  describe('generateChallenge', () => {
    it('returns a nonce and future expiry for a valid public key', () => {
      const { nonce, expiresAt } = service.generateChallenge(keypair.publicKey());
      expect(typeof nonce).toBe('string');
      expect(nonce).toHaveLength(64); // 32 bytes hex
      expect(expiresAt).toBeGreaterThan(Date.now());
    });

    it('throws BadRequestException for an invalid public key', () => {
      expect(() => service.generateChallenge('not-a-key')).toThrow(BadRequestException);
    });
  });

  describe('verifySignatureAndLogin', () => {
    it('issues access + refresh tokens on valid signature', async () => {
      const { nonce } = service.generateChallenge(keypair.publicKey());
      const message = `carbonledger:${nonce}`;
      const sig = keypair.sign(Buffer.from(message, 'utf8')).toString('hex');

      const result = await service.verifySignatureAndLogin(
        keypair.publicKey(),
        sig,
        nonce,
      );

      expect(result).toHaveProperty('access_token');
      expect(result).toHaveProperty('refresh_token');

      const decoded = jwtService.verify(result.access_token, { secret: TEST_SECRET }) as any;
      expect(decoded.sub).toBe(keypair.publicKey());
      expect(decoded.role).toBe('corporation');
      expect(decoded.type).toBe('access');
    });

    it('rejects a wrong signature', async () => {
      const { nonce } = service.generateChallenge(keypair.publicKey());
      const badSig = Buffer.alloc(64).toString('hex');
      await expect(
        service.verifySignatureAndLogin(keypair.publicKey(), badSig, nonce),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects a replayed nonce', async () => {
      const { nonce } = service.generateChallenge(keypair.publicKey());
      const message = `carbonledger:${nonce}`;
      const sig = keypair.sign(Buffer.from(message, 'utf8')).toString('hex');

      await service.verifySignatureAndLogin(keypair.publicKey(), sig, nonce);

      // Second use of same nonce must fail
      await expect(
        service.verifySignatureAndLogin(keypair.publicKey(), sig, nonce),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects an unknown nonce', async () => {
      await expect(
        service.verifySignatureAndLogin(keypair.publicKey(), 'aabb', 'random-nonce'),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('refresh', () => {
    it('issues a new token pair from a valid refresh token', async () => {
      const { nonce } = service.generateChallenge(keypair.publicKey());
      const sig = keypair
        .sign(Buffer.from(`carbonledger:${nonce}`, 'utf8'))
        .toString('hex');
      const { refresh_token } = await service.verifySignatureAndLogin(
        keypair.publicKey(),
        sig,
        nonce,
      );

      const result = await service.refresh(refresh_token);
      expect(result).toHaveProperty('access_token');
      expect(result).toHaveProperty('refresh_token');
    });

    it('rejects an access token used as refresh token', async () => {
      const { nonce } = service.generateChallenge(keypair.publicKey());
      const sig = keypair
        .sign(Buffer.from(`carbonledger:${nonce}`, 'utf8'))
        .toString('hex');
      const { access_token } = await service.verifySignatureAndLogin(
        keypair.publicKey(),
        sig,
        nonce,
      );

      await expect(service.refresh(access_token)).rejects.toThrow(UnauthorizedException);
    });

    it('rejects a tampered refresh token', async () => {
      await expect(service.refresh('garbage.token.value')).rejects.toThrow(UnauthorizedException);
    });
  });
});
