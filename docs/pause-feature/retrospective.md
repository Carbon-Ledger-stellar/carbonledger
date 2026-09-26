# Pause Feature Project Retrospective

Closes #1330.

| | |
| --- | --- |
| **Scope** | Emergency pause across contracts, backend, frontend, DevOps and docs (issue family #1190–#1330) |
| **Status at time of writing** | Contract pause shipped. Backend control path, tracing, compliance checklist and migration guide landed with #1307 / #1328 / #1329. Most frontend, UI/UX and remaining DevOps/doc issues are still open. |
| **Format** | Written retrospective prepared from the repository, the issue tracker and the implementation work, plus a facilitated session (section 7) to collect team feedback |

> This document has two parts. Sections 1–6 are findings drawn from the code
> and the tracker, and can be reviewed asynchronously. Section 7 is filled in
> during the retrospective session. Complete it before this issue is considered
> fully done.

---

## 1. Timeline

| Milestone | Reference |
| --- | --- |
| `pause_operations` / `unpause_operations` added to `carbon_credit` and `carbon_marketplace` as part of the security hardening pass | #763 |
| Role authorization audit covers pause entry points | #791, `audit/role-authorization.md` |
| Event emission test sweep across state-changing functions | #1055 / #1139 |
| Pause feature broken into ~60 cross-stack issues (backend, frontend, UI/UX, DevOps, docs) | #1190–#1330 |
| Backend pause control path with end-to-end tracing, compliance checklist, migration guide, this retrospective | #1307, #1328, #1329, #1330 |

## 2. What went well

- **Defence in depth on-chain.** The contract enforces `require_auth()`, the
  admin role and a bounded pause window (≤ 72h) by itself. A backend bug cannot
  pause the platform indefinitely or without an admin signature.
- **Auto-expiry.** `require_not_paused` clears an expired pause on the next
  call. A lost or compromised admin key cannot cause a permanent freeze.
- **Backwards-compatible storage.** Reading pause keys with `unwrap_or` means
  existing deployments upgrade with no data migration (see the migration guide).
- **Existing platform pieces fit.** The hash-chained `AuditLog`, `AdminConfig`,
  webhook dispatch and the OpenTelemetry setup all took the pause flow with no
  new tables or infrastructure.
- **Granular issues.** Small, single-purpose issues made it easy for
  contributors to pick work in parallel.

## 3. What didn't go well (lessons learned)

1. **Spec drift between issues and code.** Issues refer to
   `pause_contract()` / `unpause_contract()`. The contracts implement
   `pause_operations` / `unpause_operations`. Contributors had to
   reverse-engineer the real API.
   *Lesson:* link each issue family to a single source-of-truth spec (#1288)
   before fanning out work.
2. **Duplicate issues.** At least eight doc issues were filed twice (#1190/#1280,
   #1191/#1281, #1196/#1286, #1197/#1287, #1199/#1289, #1205/#1295, #1207/#1297,
   #1209/#1299). That risks duplicate PRs and wasted review time.
   *Lesson:* de-duplicate generated issue batches before labelling them for a
   contributor wave.
3. **Contract shipped before the operator path.** For a long time the only way
   to pause was a raw CLI invocation. No backend endpoint, audit record,
   webhook or trace existed. In an incident, operators would have had no audit
   trail.
   *Lesson:* treat "operable" (endpoint + audit + alert) as part of the
   definition of done for any emergency control.
4. **No on-chain pause events.** `pause_operations` changes state without
   `env.events().publish`. Off-chain indexers and the Horizon listener cannot
   observe a pause made outside the backend (e.g. via CLI).
   *Recommendation:* emit `(c_ledger, paused)` / `(c_ledger, unpaused)` events.
   Track this under #1293.
5. **Pause blocks upgrades.** `upgrade_contract` calls `require_not_paused`. The
   natural incident sequence (pause → ship fix) needs an unpause window before
   the fix can deploy. That may be intended, but it wasn't written down.
   *Lesson:* document interactions between emergency controls and upgrade
   paths in the contract spec.
6. **Stale runbook.** `docs/runbooks/contract-exploit.md` still says "there is
   no pause function unless one was built in". Incident docs lagged the code.
7. **Tooling friction.** `backend/package-lock.json` is out of sync with
   `package.json` and contains a Windows-only optional dependency, so a clean
   `npm ci` fails on Linux. Contributors lose time before writing any code.
8. **Overlapping state stores.** Pause state now lives in contract storage
   (authoritative), `AdminConfig` (mirror) and potentially a future
   `pause_events` table (#1232) and state versioning (#1239). Without a clear
   owner, these can drift.

## 4. Success metrics

| Metric | Target | Result / how to measure |
| --- | --- | --- |
| Admin-only pause, enforced on-chain | 100% of pause entry points | ✅ Met: `require_role(Admin)` / `require_admin` + `require_auth` in both contracts |
| State-changing functions guarded | All mutating entry points | ✅ Met: `require_not_paused` on credit and marketplace mutators, including `upgrade_contract` |
| Pause window bounded | ≤ 72h | ✅ Met: enforced in contract and backend |
| Every backend pause audited | 100% | ✅ Met: `AuditLog` row with tx hash + trace id on success |
| Every backend pause traced | 100% when sampled | ✅ Met: `pause.*` spans. Sampling caveat in `backend/docs/DISTRIBUTED_TRACING.md`. |
| Time to pause (API call → confirmed on-chain) | < 30s p95 | ⏳ Measure from `pause.contract_call` span duration in Jaeger after the first testnet drill |
| Time to detect a pause (subscriber notified) | < 60s | ⏳ Measure from `pause.event_emit` end to webhook delivery log |
| Operator UI available | Control panel + banner | ❌ Not met: #1242, #1252 open |
| Pause observable without the backend | On-chain events | ❌ Not met: see lesson 4 |
| Issue throughput | All pause issues closed | ⏳ Track in the project board |

## 5. Areas for improvement

- Emit contract events for pause and unpause (lesson 4).
- Write failed pause attempts to `AuditLog` as `Failure:` rows, not only error spans.
- Make one owner of mirrored pause state and add a reconciliation check that
  compares `AdminConfig` with on-chain storage.
- Update `docs/runbooks/contract-exploit.md` with the new endpoints and CLI fallback.
- Fix `backend/package-lock.json` so `npm ci` works on every platform.
- Close the duplicate doc issues and point them at their twins.

## 6. Recommendations for future features

1. **Spec first, fan-out second.** Publish a short spec (API names, error codes,
   storage keys, events) and reference it from every generated issue.
2. **Operability in the definition of done.** Any control with safety impact
   (pause, kill switch, key rotation) ships with an endpoint, audit record,
   alert and trace in the same milestone as the contract change.
3. **Events for every state change.** Make "emits an event" a checklist item for
   new contract entry points, and enforce it with the event emission test suite
   (#1055).
4. **Drill it.** Schedule a quarterly testnet pause drill that records
   time-to-pause and time-to-detect (section 4).
5. **Docs follow code in the same PR.** Update runbooks and error-code references
   together with the change that makes them stale.
6. **De-duplicate issue batches** before assigning them in a contributor wave.

## 7. Retrospective session and team feedback

Run as a 45-minute session (async-friendly: owners can post in the issue
thread instead).

**Agenda**
1. (5 min) Review sections 1–4 above.
2. (10 min) Silent writing: went well / didn't go well / ideas.
3. (15 min) Group and discuss.
4. (10 min) Agree on action items, each with an owner and an issue.
5. (5 min) Rate the project 1–5 on delivery, quality and collaboration.

**Session record**

| | |
| --- | --- |
| Date | |
| Facilitator | |
| Participants | |

**Team feedback**

| Area | Went well | Didn't go well | Ideas |
| --- | --- | --- | --- |
| Contracts | | | |
| Backend | | | |
| Frontend / UI-UX | | | |
| DevOps | | | |
| Docs | | | |
| Process / issue management | | | |

**Action items**

| # | Action | Owner | Issue | Due |
| --- | --- | --- | --- | --- |
| 1 | Emit on-chain pause/unpause events | | #1293 | |
| 2 | Update contract-exploit runbook for pause | | | |
| 3 | Fix backend lockfile for `npm ci` | | | |
| 4 | Close duplicate pause doc issues | | | |
| 5 | | | | |
