import { Test, TestingModule } from '@nestjs/testing';
import { JwtModule, JwtService } from '@nestjs/jwt';

import { NotificationsGateway } from './notifications.gateway';
import {
  VERIFIER_EVENTS,
  ProjectPendingVerificationEvent,
} from './notification.events';

const SECRET = 'test-secret-for-gateway-specs';
const ISSUER = 'carbonledger';
const VERIFIER = 'GVERIFIER000000000000000000000000000000000000000000000001';
const OTHER_VERIFIER = 'GVERIFIER000000000000000000000000000000000000000000000002';

/** Minimal Socket double — records join/emit/disconnect for assertions. */
function makeSocket(auth: Record<string, unknown> = {}) {
  return {
    id: 'socket-test-1',
    data: {} as Record<string, unknown>,
    handshake: { auth, query: {}, headers: {} },
    join: jest.fn().mockResolvedValue(undefined),
    emit: jest.fn(),
    disconnect: jest.fn(),
  };
}

describe('NotificationsGateway', () => {
  let gateway: NotificationsGateway;
  let jwt: JwtService;
  let emitToRoom: jest.Mock;
  let to: jest.Mock;

  beforeEach(async () => {
    process.env.JWT_SECRET = SECRET;
    process.env.JWT_ISSUER = ISSUER;

    const module: TestingModule = await Test.createTestingModule({
      imports: [JwtModule.register({ secret: SECRET })],
      providers: [NotificationsGateway],
    }).compile();

    gateway = module.get(NotificationsGateway);
    jwt = module.get(JwtService);

    emitToRoom = jest.fn();
    to = jest.fn().mockReturnValue({ emit: emitToRoom });
    gateway.server = { to } as never;
  });

  const sign = (payload: Record<string, unknown>) =>
    jwt.sign(payload, { secret: SECRET, issuer: ISSUER, expiresIn: '5m' });

  const accessToken = (sub = VERIFIER) =>
    sign({ sub, role: 'verifier', type: 'access' });

  // ── Authentication ─────────────────────────────────────────────────────────

  describe('authentication', () => {
    it('rejects a connection with no token', async () => {
      const client = makeSocket();

      await gateway.handleConnection(client as never);

      expect(client.disconnect).toHaveBeenCalledWith(true);
      expect(client.join).not.toHaveBeenCalled();
    });

    it('rejects a malformed token', async () => {
      const client = makeSocket({ token: 'not-a-jwt' });

      await gateway.handleConnection(client as never);

      expect(client.disconnect).toHaveBeenCalledWith(true);
      expect(client.join).not.toHaveBeenCalled();
    });

    it('rejects a token signed with the wrong secret', async () => {
      const forged = jwt.sign(
        { sub: VERIFIER, role: 'verifier', type: 'access' },
        { secret: 'wrong-secret', issuer: ISSUER },
      );
      const client = makeSocket({ token: forged });

      await gateway.handleConnection(client as never);

      expect(client.disconnect).toHaveBeenCalledWith(true);
    });

    it('rejects a refresh token — only access tokens may open a socket', async () => {
      const client = makeSocket({
        token: sign({ sub: VERIFIER, role: 'verifier', type: 'refresh' }),
      });

      await gateway.handleConnection(client as never);

      expect(client.disconnect).toHaveBeenCalledWith(true);
      expect(client.join).not.toHaveBeenCalled();
    });

    it('accepts a valid access token', async () => {
      const client = makeSocket({ token: accessToken() });

      await gateway.handleConnection(client as never);

      expect(client.disconnect).not.toHaveBeenCalled();
      expect(client.data.publicKey).toBe(VERIFIER);
    });

    it('accepts a Bearer-prefixed token', async () => {
      const client = makeSocket({ token: `Bearer ${accessToken()}` });

      await gateway.handleConnection(client as never);

      expect(client.disconnect).not.toHaveBeenCalled();
      expect(client.join).toHaveBeenCalledWith(VERIFIER);
    });

    it('reads the token from the query string as a fallback', async () => {
      const client = makeSocket();
      client.handshake.query = { token: accessToken() } as never;

      await gateway.handleConnection(client as never);

      expect(client.join).toHaveBeenCalledWith(VERIFIER);
    });
  });

  // ── Room assignment ────────────────────────────────────────────────────────

  describe('room assignment', () => {
    it('joins the room named after the token subject', async () => {
      const client = makeSocket({ token: accessToken() });

      await gateway.handleConnection(client as never);

      expect(client.join).toHaveBeenCalledWith(VERIFIER);
      expect(client.join).toHaveBeenCalledTimes(1);
    });

    it('ignores a client-supplied room and uses the token subject', async () => {
      // A caller trying to eavesdrop on another verifier's stream.
      const client = makeSocket({
        token: accessToken(VERIFIER),
        room: OTHER_VERIFIER,
        verifierAddress: OTHER_VERIFIER,
      });

      await gateway.handleConnection(client as never);

      expect(client.join).toHaveBeenCalledWith(VERIFIER);
      expect(client.join).not.toHaveBeenCalledWith(OTHER_VERIFIER);
    });
  });

  // ── Event delivery ─────────────────────────────────────────────────────────

  describe('event delivery', () => {
    const payload: ProjectPendingVerificationEvent = {
      verifierAddress: VERIFIER,
      projectId: 'proj-001',
      name: 'Amazon Reforestation',
      methodology: 'VCS',
      country: 'BR',
      vintageYear: 2024,
      emittedAt: new Date().toISOString(),
    };

    it('delivers project.pending_verification to the assigned verifier only', () => {
      gateway.handleProjectPending(payload);

      expect(to).toHaveBeenCalledWith(VERIFIER);
      expect(emitToRoom).toHaveBeenCalledWith(
        VERIFIER_EVENTS.PROJECT_PENDING_VERIFICATION,
        payload,
      );
    });

    it('delivers project.verification_deadline_24h', () => {
      const deadline = {
        verifierAddress: VERIFIER,
        projectId: 'proj-002',
        name: 'Kenya Cookstoves',
        pendingSince: new Date().toISOString(),
        hoursRemaining: 24,
        emittedAt: new Date().toISOString(),
      };

      gateway.handleDeadline(deadline);

      expect(to).toHaveBeenCalledWith(VERIFIER);
      expect(emitToRoom).toHaveBeenCalledWith(
        VERIFIER_EVENTS.PROJECT_VERIFICATION_DEADLINE_24H,
        deadline,
      );
    });

    it('delivers oracle.monitoring_stale', () => {
      const stale = {
        verifierAddress: VERIFIER,
        projectId: 'proj-003',
        name: 'Solar Cookers',
        lastMonitoringAt: new Date().toISOString(),
        daysSinceLastMonitoring: 45,
        emittedAt: new Date().toISOString(),
      };

      gateway.handleMonitoringStale(stale);

      expect(to).toHaveBeenCalledWith(VERIFIER);
      expect(emitToRoom).toHaveBeenCalledWith(
        VERIFIER_EVENTS.ORACLE_MONITORING_STALE,
        stale,
      );
    });

    it('drops an event with no verifierAddress rather than broadcasting it', () => {
      gateway.handleProjectPending({
        ...payload,
        verifierAddress: '',
      });

      expect(to).not.toHaveBeenCalled();
      expect(emitToRoom).not.toHaveBeenCalled();
    });
  });
});
