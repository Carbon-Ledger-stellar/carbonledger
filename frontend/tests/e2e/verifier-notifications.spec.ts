import { test, expect, type Page } from '@playwright/test';
import { createServer, type Server as HttpServer } from 'node:http';
import { AddressInfo } from 'node:net';
import { Server as SocketServer } from 'socket.io';

/**
 * Verifier push notifications — receipt over WebSocket, and the polling
 * fallback when the socket cannot be established.
 *
 * Each WebSocket test stands up its own stub gateway on an ephemeral port and
 * points the page at it via window.__CL_WS_URL__ (NEXT_PUBLIC_* is inlined at
 * build time, so it can't vary per test). That keeps the tests independent of
 * any real backend and safe to run in parallel.
 */

const VERIFIER = 'GVERIFIER000000000000000000000000000000000000000000000001';
// Any non-empty string: the stub gateway does not verify signatures, and the
// polling path only forwards it as a bearer header.
const TOKEN = 'test-jwt-token';

const PROJECT = {
  id: 'proj-001',
  projectId: 'proj-001',
  name: 'Amazon Reforestation',
  methodology: 'VCS',
  country: 'BR',
  status: 'Pending',
  methodologyScore: 82,
  createdAt: new Date().toISOString(),
};

const EVENT_PENDING = 'project.pending_verification';

interface StubGateway {
  io: SocketServer;
  url: string;
  close: () => Promise<void>;
}

/** Stub of NotificationsGateway: same namespace, room-per-verifier on connect. */
async function startStubGateway(): Promise<StubGateway> {
  const http: HttpServer = createServer();
  const io = new SocketServer(http, { cors: { origin: '*', credentials: true } });

  io.of('/notifications').on('connection', (socket) => {
    const room = String(socket.handshake.auth?.verifierAddress ?? VERIFIER);
    void socket.join(room);
    socket.emit('connected', { publicKey: room, room });
  });

  await new Promise<void>((resolve, reject) => {
    http.once('error', reject);
    http.listen(0, resolve); // ephemeral port — parallel-safe
  });

  const { port } = http.address() as AddressInfo;

  return {
    io,
    url: `http://localhost:${port}`,
    close: async () => {
      // Drop keep-alives first or close() waits on them.
      http.closeAllConnections?.();
      await new Promise<void>((resolve) => io.close(() => resolve()));
    },
  };
}

/** Points the hook at a specific gateway URL before any app code runs. */
async function useGatewayUrl(page: Page, url: string) {
  await page.addInitScript((value) => {
    (window as unknown as { __CL_WS_URL__: string }).__CL_WS_URL__ = value;
  }, url);
}

/**
 * Replaces window.Notification with a recorder so we can assert a desktop
 * notification was raised without depending on real OS-level permissions.
 */
async function stubNotificationApi(page: Page) {
  await page.addInitScript(() => {
    const raised: Array<{ title: string; body?: string }> = [];
    class StubNotification {
      static permission: NotificationPermission = 'granted';
      static requestPermission(): Promise<NotificationPermission> {
        return Promise.resolve('granted');
      }
      constructor(title: string, options?: NotificationOptions) {
        raised.push({ title, body: options?.body });
      }
    }
    (window as any).Notification = StubNotification;
    (window as any).__raisedNotifications = raised;
  });
}

/**
 * The dashboard also renders <OracleStatus/>, which calls an admin-only
 * endpoint. Unauthenticated that returns 401, and admin-api.ts responds by
 * navigating to /login — which detaches the inputs mid-test. Stubbing it keeps
 * this spec focused on notification delivery rather than admin auth.
 */
function stubOracleHealth(page: Page) {
  // A glob is not used here: Playwright's `*` does not match `/`, so it cannot
  // span the `oracle/health` path segment.
  return page.route(/\/admin\/oracle[-/]health/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
}

/** Fills the dashboard's key/token inputs, which is what activates the hook. */
async function signIn(page: Page) {
  await stubOracleHealth(page);
  await page.goto('/verifier/dashboard');
  await page.getByPlaceholder('Your Stellar public key (G...)').fill(VERIFIER);
  await page.getByPlaceholder('JWT token').fill(TOKEN);
}

function emptyPendingProjects(page: Page) {
  return page.route('**/pending-projects', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
}

test.describe('Verifier notifications — WebSocket', () => {
  let gateway: StubGateway;

  test.beforeEach(async () => {
    gateway = await startStubGateway();
  });

  test.afterEach(async () => {
    await gateway?.close();
  });

  test('renders a project.pending_verification event pushed over the socket', async ({
    page,
  }) => {
    await useGatewayUrl(page, gateway.url);
    await stubNotificationApi(page);
    // The dashboard's own project list is irrelevant here; keep it empty so the
    // only thing under test is the pushed event.
    await emptyPendingProjects(page);

    await signIn(page);

    // Wait for the socket to report itself connected before emitting.
    await expect(page.getByTestId('notification-status')).toHaveAttribute(
      'data-transport',
      'websocket',
    );

    gateway.io.of('/notifications').to(VERIFIER).emit(EVENT_PENDING, {
      verifierAddress: VERIFIER,
      projectId: PROJECT.projectId,
      name: PROJECT.name,
      methodology: PROJECT.methodology,
      country: PROJECT.country,
      vintageYear: 2024,
      emittedAt: new Date().toISOString(),
    });

    const item = page.getByTestId('notification-item');
    await expect(item).toHaveCount(1);
    await expect(item).toContainText(PROJECT.name);
    await expect(item).toHaveAttribute('data-event', EVENT_PENDING);
  });

  test('raises a browser notification on receipt', async ({ page }) => {
    await useGatewayUrl(page, gateway.url);
    await stubNotificationApi(page);
    await emptyPendingProjects(page);

    await signIn(page);
    await expect(page.getByTestId('notification-status')).toHaveAttribute(
      'data-transport',
      'websocket',
    );

    gateway.io.of('/notifications').to(VERIFIER).emit(EVENT_PENDING, {
      verifierAddress: VERIFIER,
      projectId: PROJECT.projectId,
      name: PROJECT.name,
      emittedAt: new Date().toISOString(),
    });

    await expect(page.getByTestId('notification-item')).toHaveCount(1);

    const raised = await page.evaluate(
      () => (window as any).__raisedNotifications,
    );
    expect(raised.length).toBeGreaterThan(0);
    expect(raised[0].title).toContain('New project awaiting review');
    expect(raised[0].body).toContain(PROJECT.name);
  });
});

test.describe('Verifier notifications — polling fallback', () => {
  /** Nothing listens here, so the socket connection is refused immediately. */
  const DEAD_GATEWAY = 'http://localhost:1';

  function pendingProjectsReturns(page: Page) {
    return page.route('**/pending-projects', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([PROJECT]),
      }),
    );
  }

  test('falls back to polling and still surfaces new projects', async ({ page }) => {
    await useGatewayUrl(page, DEAD_GATEWAY);
    await stubNotificationApi(page);
    await pendingProjectsReturns(page);

    await signIn(page);

    await expect(page.getByTestId('notification-status')).toHaveAttribute(
      'data-transport',
      'polling',
    );
    await expect(page.getByTestId('transport-label')).toContainText('60s');

    // The first poll fires immediately rather than after a full interval.
    const item = page.getByTestId('notification-item');
    await expect(item).toHaveCount(1);
    await expect(item).toContainText(PROJECT.name);
  });

  test('does not re-notify for a project already seen', async ({ page }) => {
    await useGatewayUrl(page, DEAD_GATEWAY);
    await stubNotificationApi(page);
    await pendingProjectsReturns(page);

    await signIn(page);
    await expect(page.getByTestId('notification-item')).toHaveCount(1);

    // Repeated polls of the same payload must not stack up.
    await page.waitForTimeout(2_000);
    await expect(page.getByTestId('notification-item')).toHaveCount(1);
  });
});
