import { Request } from 'express';

/**
 * Lets a controller/service snapshot an entity's state immediately before
 * mutating it, so AuditInterceptor can record a before/after diff on the
 * resulting audit log entry (#963 — "Before/after state recorded").
 *
 * The snapshot is stashed on the in-flight request object, which is the
 * simplest way to hand a value from deep inside a service method back up to
 * the interceptor wrapping the same request — no extra DI plumbing, and it
 * is automatically garbage-collected with the request once handled.
 *
 * Usage inside a mutating handler, right after reading current state and
 * before applying the write:
 *
 *   const project = await this.getProjectOrThrow(projectId);
 *   captureAuditBeforeState(req, project);
 *   const updated = await this.prisma.carbonProject.update(...);
 *
 * Adoption is opt-in per route — routes that never call this simply log
 * `before: undefined`, identical to today's behaviour.
 */
const BEFORE_STATE_KEY = '__auditBeforeState';

type RequestWithAuditState = Request & { [BEFORE_STATE_KEY]?: unknown };

export function captureAuditBeforeState(req: Request | undefined, state: unknown): void {
  if (!req) return;
  (req as RequestWithAuditState)[BEFORE_STATE_KEY] = state;
}

/** Reads and clears the captured "before" snapshot for this request, if any. */
export function consumeAuditBeforeState(req: Request | undefined): unknown {
  if (!req) return undefined;
  const typed = req as RequestWithAuditState;
  const state = typed[BEFORE_STATE_KEY];
  delete typed[BEFORE_STATE_KEY];
  return state;
}
