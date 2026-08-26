import { Test } from '@nestjs/testing';
import { INestApplication, VersioningType } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthController } from '../src/auth/auth.controller';
import { AuthService } from '../src/auth/auth.service';

const request = require('supertest');
const cookieParser = require('cookie-parser');

/**
 * Regression coverage for the refresh-cookie Path attribute.
 *
 * `test-helpers.ts` boots the app without `setGlobalPrefix`/`enableVersioning`,
 * so it never exercises the real `/api/v1/auth/*` route the app actually
 * serves in production — a cookie scoped to the wrong Path silently never
 * gets sent back by a browser, which previously broke `/auth/refresh`
 * entirely. This suite mirrors main.ts's prefix/versioning setup so that
 * class of bug can't slip back in unnoticed.
 */
describe('Auth refresh-token cookie (mounted at the real /api/v1 prefix)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }])],
      controllers: [AuthController],
      providers: [
        {
          provide: AuthService,
          useValue: {
            verifySignatureAndLogin: async () => ({ access_token: 'AT', refresh_token: 'RT' }),
            refresh: async () => ({ access_token: 'AT2', refresh_token: 'RT2' }),
            logout: async () => ({ message: 'Logged out successfully' }),
          },
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1', prefix: 'v' });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('sets the refresh cookie with a Path that covers the real mounted routes', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/verify')
      .send({ publicKey: 'x', signature: 'y', nonce: 'z' })
      .expect(200);

    const setCookie = res.headers['set-cookie'][0];
    expect(setCookie).toMatch(/refresh_token=RT;/);
    expect(setCookie).toMatch(/Path=\/api\/v1\/auth/);
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/SameSite=Strict/i);
  });

  it('a cookie-jar-aware client can log in and then call refresh using only the cookie', async () => {
    const agent = request.agent(app.getHttpServer());

    await agent
      .post('/api/v1/auth/verify')
      .send({ publicKey: 'x', signature: 'y', nonce: 'z' })
      .expect(200);

    // No body refreshToken supplied — this only succeeds if the agent's
    // cookie jar actually re-attached the Set-Cookie from /verify.
    const refreshRes = await agent.post('/api/v1/auth/refresh').send({});

    expect(refreshRes.status).toBe(200);
    expect(refreshRes.body.access_token).toBe('AT2');
  });

  it('logout clears the cookie under the same Path it was set on', async () => {
    const agent = request.agent(app.getHttpServer());
    await agent
      .post('/api/v1/auth/verify')
      .send({ publicKey: 'x', signature: 'y', nonce: 'z' })
      .expect(200);

    const logoutRes = await agent.post('/api/v1/auth/logout').send({}).expect(200);
    const clearedCookie = logoutRes.headers['set-cookie'][0];
    expect(clearedCookie).toMatch(/refresh_token=;/);
    expect(clearedCookie).toMatch(/Path=\/api\/v1\/auth/);
  });
});
