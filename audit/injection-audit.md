# Injection Audit Report

## Scope
- Backend NestJS controllers and services
- Prisma raw query usage
- Redis key construction
- User supplied string fields stored and later displayed
- Webhook payload handling

## Findings and Remediations

### 1. Raw SQL / Prisma injection risk
- Finding: Project and retirement search services used Prisma raw query builders with interpolated SQL fragments.
- Remediation: Replaced raw query paths with Prisma ORM queries using structured `where` clauses and safe parameter handling.

### 2. Redis key construction risk
- Finding: Redis-backed logic could derive keys from untrusted input.
- Remediation: Introduced allowlisted Redis key prefixes and a normalization step before any read/write/delete operation.

### 3. Stored XSS / reflected XSS risk
- Finding: Project descriptions and retirement beneficiary/reason values were stored and later returned without sanitization.
- Remediation: Added shared sanitization helpers to normalize and escape user-controlled strings before persistence and before response serialization.

### 4. Webhook header/payload injection risk
- Finding: Webhook payloads could carry untrusted values into persistence paths without normalization.
- Remediation: Sanitized webhook payload fields and restricted the accepted status values before processing.

## Notes
- No test run was executed per the request.
- The implementation preserves existing routes and service behavior while removing the unsafe code paths.
