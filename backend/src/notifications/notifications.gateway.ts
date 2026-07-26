import { Logger } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { OnEvent } from '@nestjs/event-emitter';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';

import {
  VERIFIER_EVENTS,
  OracleMonitoringStaleEvent,
  ProjectPendingVerificationEvent,
  ProjectVerificationDeadlineEvent,
} from './notification.events';

/** Shape of our access-token payload — mirrors JwtStrategy.validate(). */
interface AccessTokenPayload {
  sub: string;
  role: string;
  type: string;
}

/**
 * Pushes verification-related events to the assigned verifier in real time.
 *
 * Auth mirrors the REST guard: same JWT_SECRET/JWT_ISSUER and the same
 * `type: 'access'` requirement enforced by JwtStrategy. Passport can't be used
 * directly here because there is no HTTP Authorization header on a socket, so
 * the token is read from the Socket.io handshake and verified with JwtService.
 *
 * Each connection joins exactly one room, named after the caller's own wallet
 * address taken from the *token* (never from client-supplied data), so a client
 * cannot subscribe to another verifier's stream.
 */
@WebSocketGateway({
  namespace: '/notifications',
  cors: {
    origin: process.env.ALLOWED_ORIGINS?.split(',') ?? ['http://localhost:3000'],
    credentials: true,
  },
})
export class NotificationsGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(NotificationsGateway.name);

  @WebSocketServer()
  server: Server;

  constructor(private readonly jwtService: JwtService) {}

  async handleConnection(client: Socket): Promise<void> {
    const token = this.extractToken(client);

    if (!token) {
      this.disconnect(client, 'missing token');
      return;
    }

    let payload: AccessTokenPayload;
    try {
      payload = await this.jwtService.verifyAsync<AccessTokenPayload>(token, {
        secret: process.env.JWT_SECRET || 'dev-secret-change-in-production',
        issuer: process.env.JWT_ISSUER || 'carbonledger',
      });
    } catch {
      this.disconnect(client, 'invalid token');
      return;
    }

    // Refresh tokens must not open a socket — same rule as JwtStrategy.
    if (payload.type !== 'access') {
      this.disconnect(client, 'invalid token type');
      return;
    }

    if (!payload.sub) {
      this.disconnect(client, 'token missing subject');
      return;
    }

    client.data.publicKey = payload.sub;
    client.data.role = payload.role;
    await client.join(payload.sub);

    this.logger.log(
      `Verifier socket connected publicKey=${payload.sub} role=${payload.role} id=${client.id}`,
    );
    client.emit('connected', { publicKey: payload.sub, room: payload.sub });
  }

  handleDisconnect(client: Socket): void {
    if (client.data?.publicKey) {
      this.logger.log(
        `Verifier socket disconnected publicKey=${client.data.publicKey} id=${client.id}`,
      );
    }
  }

  // ── Event fan-out ───────────────────────────────────────────────────────────
  // EventEmitter2 delivers domain events here; each is relayed to exactly the
  // room named by the payload's verifierAddress.

  @OnEvent(VERIFIER_EVENTS.PROJECT_PENDING_VERIFICATION)
  handleProjectPending(payload: ProjectPendingVerificationEvent): void {
    this.deliver(VERIFIER_EVENTS.PROJECT_PENDING_VERIFICATION, payload);
  }

  @OnEvent(VERIFIER_EVENTS.PROJECT_VERIFICATION_DEADLINE_24H)
  handleDeadline(payload: ProjectVerificationDeadlineEvent): void {
    this.deliver(VERIFIER_EVENTS.PROJECT_VERIFICATION_DEADLINE_24H, payload);
  }

  @OnEvent(VERIFIER_EVENTS.ORACLE_MONITORING_STALE)
  handleMonitoringStale(payload: OracleMonitoringStaleEvent): void {
    this.deliver(VERIFIER_EVENTS.ORACLE_MONITORING_STALE, payload);
  }

  private deliver(event: string, payload: { verifierAddress?: string }): void {
    // An unassigned project has no room to target; dropping beats broadcasting
    // it to every connected verifier.
    if (!payload?.verifierAddress) {
      this.logger.warn(`Dropping ${event} with no verifierAddress`);
      return;
    }

    this.server?.to(payload.verifierAddress).emit(event, payload);
    this.logger.debug(`Delivered ${event} to room=${payload.verifierAddress}`);
  }

  /**
   * socket.io-client sends `auth: { token }`; the query-string and
   * Authorization-header forms are accepted as fallbacks for other clients.
   */
  private extractToken(client: Socket): string | null {
    const fromAuth = client.handshake?.auth?.token;
    if (typeof fromAuth === 'string' && fromAuth) return this.strip(fromAuth);

    const fromQuery = client.handshake?.query?.token;
    if (typeof fromQuery === 'string' && fromQuery) return this.strip(fromQuery);

    const header = client.handshake?.headers?.authorization;
    if (typeof header === 'string' && header) return this.strip(header);

    return null;
  }

  private strip(token: string): string {
    return token.startsWith('Bearer ') ? token.slice(7) : token;
  }

  private disconnect(client: Socket, reason: string): void {
    this.logger.warn(`Rejecting socket ${client.id}: ${reason}`);
    client.emit('unauthorized', { message: reason });
    client.disconnect(true);
  }
}
