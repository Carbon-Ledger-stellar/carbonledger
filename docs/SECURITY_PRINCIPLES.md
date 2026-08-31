# Security Principles for Contributors

Essential security guidelines for all developers contributing to CarbonLedger. This guide covers authentication, validation, secrets management, logging, and common vulnerabilities.

## Table of Contents
- [Core Security Principles](#core-security-principles)
- [Authentication & Authorization](#authentication--authorization)
- [Input Validation](#input-validation)
- [Secrets Management](#secrets-management)
- [Secure Logging](#secure-logging)
- [Common Vulnerabilities](#common-vulnerabilities)
- [Secure Code Examples](#secure-code-examples)
- [Anti-Patterns to Avoid](#anti-patterns-to-avoid)
- [Security Checklist](#security-checklist)

---

## Core Security Principles

### 1. Defense in Depth
- **Multiple layers of defense** - Don't rely on a single security control
- **Apply principle of least privilege** - Users/services only access what they need
- **Assume external input is hostile** - Validate everything
- **Encrypt sensitive data** at rest and in transit

### 2. Fail Securely
- **Defaults to deny** - Reject access unless explicitly permitted
- **Error handling** - Don't leak sensitive info in error messages
- **Fallback safely** - If security check fails, default to locked state

### 3. Keep It Simple
- **Simple code is secure code** - Complex security logic is harder to audit
- **Avoid custom cryptography** - Use well-vetted libraries
- **Document security decisions** - Explain why, not just what

### 4. Fix Security Issues Immediately
- **Treat security bugs as critical** - Fix before any new features
- **No workarounds in production** - Fix root cause
- **Notify stakeholders early** - Transparency builds trust

### 5. Security by Design
- **Think about security from day one** - Not an afterthought
- **Threat model new features** - What could go wrong?
- **Code review with security in mind** - Look for vulnerabilities

---

## Authentication & Authorization

### Authentication Best Practices

#### 1. API Key Authentication

```typescript
// ✅ SECURE: Validate API key with proper headers
import { FastifyRequest, FastifyReply } from 'fastify';

export async function validateApiKey(request: FastifyRequest) {
  const authHeader = request.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new UnauthorizedError('Missing or invalid authorization header');
  }
  
  const token = authHeader.slice(7);
  
  // Hash the token before checking database (never store plain tokens)
  const tokenHash = await hashToken(token);
  
  const apiKey = await db.apiKey.findUnique({
    where: { hash: tokenHash },
    include: { user: true }
  });
  
  if (!apiKey || apiKey.expiresAt < new Date()) {
    throw new UnauthorizedError('Invalid or expired API key');
  }
  
  // Log authentication for audit trail
  await auditLog.create({
    userId: apiKey.userId,
    action: 'API_AUTHENTICATION',
    resource: 'api_key',
    status: 'SUCCESS',
    timestamp: new Date(),
    ipAddress: request.ip
  });
  
  return apiKey;
}

// ❌ INSECURE: Storing plain tokens
const token = req.headers.authorization;
const user = await db.user.findByApiKey(token); // WRONG: token is plain text
```

#### 2. JWT Token Validation

```typescript
// ✅ SECURE: Proper JWT validation with expiration
import jwt from '@fastify/jwt';

const app = fastify();
await app.register(jwt, {
  secret: process.env.JWT_SECRET, // From secure vault
  sign: {
    expiresIn: '15m' // Short expiration
  }
});

app.post('/login', async (request, reply) => {
  const user = await validateCredentials(request.body);
  
  if (!user) {
    // Don't reveal if username or password was wrong
    throw new UnauthorizedError('Invalid credentials');
  }
  
  // Generate tokens with different expiration times
  const accessToken = app.jwt.sign(
    { 
      userId: user.id, 
      role: user.role,
      scope: user.permissions 
    },
    { expiresIn: '15m' }
  );
  
  const refreshToken = app.jwt.sign(
    { 
      userId: user.id,
      type: 'refresh'
    },
    { expiresIn: '7d' }
  );
  
  // Store refresh token hash in database (not in JWT)
  const refreshTokenHash = await hashToken(refreshToken);
  await db.refreshToken.create({
    userId: user.id,
    hash: refreshTokenHash,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    revokedAt: null
  });
  
  return {
    accessToken,
    refreshToken,
    expiresIn: 900 // 15 minutes in seconds
  };
});

// ❌ INSECURE: Long expiration, no refresh token rotation
app.post('/login', async (request, reply) => {
  const token = jwt.sign(user, process.env.JWT_SECRET, {
    expiresIn: '365d' // WRONG: Too long, can't be revoked
  });
  return { token };
});
```

#### 3. Multi-Factor Authentication

```typescript
// ✅ SECURE: MFA for sensitive operations
export async function enforceMFA(userId: string) {
  const user = await db.user.findUnique({ where: { id: userId } });
  
  if (!user.mfaEnabled) {
    throw new ForbiddenError('MFA is required for this operation');
  }
  
  // Generate time-based OTP
  const secret = user.mfaSecret; // Stored securely
  const otp = generateTOTP(secret);
  
  // Send via secure channel (SMS, authenticator app, email)
  await sendMFAChallenge(user.email, otp);
  
  return { mfaChallengeId: generateSecureToken() };
}

// ❌ INSECURE: No MFA option for sensitive operations
export async function transferCredits(fromUser, toUser, amount) {
  // Anyone with access token can transfer credits
  // No additional verification required
  await db.transfer.create({ from: fromUser, to: toUser, amount });
}
```

### Authorization Best Practices

#### 1. Role-Based Access Control (RBAC)

```typescript
// ✅ SECURE: Explicit role checking with principle of least privilege
const roles = {
  ADMIN: ['read:*', 'write:*', 'delete:*', 'manage:users'],
  VERIFIER: ['read:projects', 'write:verifications', 'read:credits'],
  PROJECT_OWNER: ['read:own_projects', 'write:own_projects', 'read:credits', 'write:credits'],
  VIEWER: ['read:public_data']
};

export function requirePermission(permission: string) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const user = await request.user;
    const userPermissions = roles[user.role] || [];
    
    // Check for exact match or wildcard match
    const hasPermission = userPermissions.some(p => 
      p === permission || p === 'write:*' || p === 'read:*'
    );
    
    if (!hasPermission) {
      await auditLog.create({
        userId: user.id,
        action: 'UNAUTHORIZED_ACCESS_ATTEMPT',
        resource: permission,
        status: 'DENIED',
        ipAddress: request.ip
      });
      
      throw new ForbiddenError(`Insufficient permissions for ${permission}`);
    }
  };
}

// Usage
app.post('/admin/users', {
  preHandler: requirePermission('manage:users')
}, async (request, reply) => {
  // Only admins reach here
});

// ❌ INSECURE: String-based role check, easy to bypass
app.post('/admin/users', async (request, reply) => {
  if (request.user.role !== 'ADMIN') {
    return reply.status(403).send('Forbidden');
  }
  // No audit logging
});
```

#### 2. Ownership Verification

```typescript
// ✅ SECURE: Verify user owns the resource before allowing modification
export async function updateProject(
  request: FastifyRequest, 
  projectId: string
) {
  const user = await request.user;
  
  const project = await db.project.findUnique({ 
    where: { id: projectId },
    select: { ownerId: true, id: true } // Only select needed fields
  });
  
  if (!project) {
    throw new NotFoundError('Project not found');
  }
  
  // Verify ownership
  if (project.ownerId !== user.id) {
    await auditLog.create({
      userId: user.id,
      action: 'UNAUTHORIZED_UPDATE_ATTEMPT',
      resource: `project:${projectId}`,
      status: 'DENIED',
      reason: 'User does not own this resource'
    });
    
    throw new ForbiddenError('You do not have permission to modify this project');
  }
  
  // Only update allowed fields
  const allowedFields = ['name', 'description', 'location'];
  const updateData = Object.keys(request.body)
    .filter(key => allowedFields.includes(key))
    .reduce((obj, key) => ({ ...obj, [key]: request.body[key] }), {});
  
  return db.project.update({
    where: { id: projectId },
    data: updateData
  });
}

// ❌ INSECURE: No ownership check
export async function updateProject(request: FastifyRequest, projectId: string) {
  // Any authenticated user can update any project
  return db.project.update({
    where: { id: projectId },
    data: request.body
  });
}
```

---

## Input Validation

### 1. Whitelist Validation

```typescript
// ✅ SECURE: Whitelist allowed values and types
import { z } from 'zod';

const CreateProjectSchema = z.object({
  name: z.string()
    .min(3, 'Name must be at least 3 characters')
    .max(255, 'Name must be at most 255 characters')
    .regex(/^[a-zA-Z0-9\s\-_.]+$/, 'Name contains invalid characters'),
  
  projectType: z.enum([
    'SOLAR',
    'WIND',
    'HYDRO',
    'BIOMASS',
    'GEOTHERMAL',
    'OTHER'
  ]),
  
  location: z.object({
    country: z.string().length(2, 'Country code must be 2 characters'),
    region: z.string().max(100),
    coordinates: z.object({
      latitude: z.number().min(-90).max(90),
      longitude: z.number().min(-180).max(180)
    })
  }),
  
  quantity: z.number()
    .positive('Quantity must be positive')
    .max(1_000_000, 'Quantity cannot exceed 1 million'),
  
  startDate: z.date()
    .min(new Date('2020-01-01'), 'Start date cannot be before 2020')
    .max(new Date(), 'Start date cannot be in the future'),
  
  ownerAddress: z.string()
    .regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid Ethereum address')
});

app.post('/projects', async (request, reply) => {
  try {
    const validatedData = CreateProjectSchema.parse(request.body);
    // validatedData is now guaranteed to match schema
    
    const project = await db.project.create({
      data: validatedData
    });
    
    return project;
  } catch (error) {
    if (error instanceof z.ZodError) {
      // Return validation errors without exposing internal structure
      return reply.status(400).send({
        error: 'Validation failed',
        details: error.errors
      });
    }
    throw error;
  }
});

// ❌ INSECURE: No validation, directly use request body
app.post('/projects', async (request, reply) => {
  const project = await db.project.create({
    data: request.body // WRONG: No validation
  });
});
```

### 2. SQL Injection Prevention

```typescript
// ✅ SECURE: Use parameterized queries (ORM handles this)
const projects = await db.project.findMany({
  where: {
    name: {
      contains: userInput // ORM escapes automatically
    }
  }
});

// ✅ SECURE: Prisma prepared statements
const project = await db.project.findUnique({
  where: { id: projectId } // ID is parameterized
});

// ❌ INSECURE: String interpolation
const query = `SELECT * FROM projects WHERE name = '${userInput}'`;
// If userInput = "'; DROP TABLE projects; --"
// Query becomes: SELECT * FROM projects WHERE name = ''; DROP TABLE projects; --'
```

### 3. XSS Prevention

```typescript
// ✅ SECURE: HTML entity encoding for responses
import { escapeHtml } from 'escape-html';

app.get('/projects/:id', async (request, reply) => {
  const project = await db.project.findUnique({
    where: { id: request.params.id }
  });
  
  // HTML encode before sending to client
  return {
    name: escapeHtml(project.name),
    description: escapeHtml(project.description)
  };
});

// ✅ SECURE: Set Content-Security-Policy headers
app.register(require('@fastify/helmet'), {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "https://trusted-cdn.com"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "https:", "data:"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"]
    }
  }
});

// ❌ INSECURE: Directly returning user input
app.get('/projects/:id', async (request, reply) => {
  const project = await db.project.findUnique({
    where: { id: request.params.id }
  });
  return project; // Name might contain <script> tags
});
```

### 4. CSRF Protection

```typescript
// ✅ SECURE: CSRF tokens for state-changing operations
app.register(require('@fastify/csrf'), {
  tokenFieldName: '_csrf',
  cookieOptions: {
    httpOnly: true,
    secure: true, // HTTPS only
    sameSite: 'strict'
  }
});

app.post('/projects', async (request, reply) => {
  // CSRF token is automatically validated
  const project = await db.project.create({
    data: request.body
  });
  
  return project;
});

// ❌ INSECURE: No CSRF protection
app.post('/projects', async (request, reply) => {
  // Vulnerable to cross-site request forgery
  const project = await db.project.create({
    data: request.body
  });
});
```

---

## Secrets Management

### 1. Environment Variables

```bash
# ✅ SECURE: Use .env.example (never commit real secrets)
# .env.example
DATABASE_URL=postgresql://user:password@localhost:5432/carbonledger
JWT_SECRET=your-secret-here
API_KEY_ENCRYPTION_KEY=your-key-here
BLOCKCHAIN_RPC_URL=https://mainnet.infura.io/v3/YOUR_KEY

# ✅ .gitignore
.env
.env.local
.env.*.local
.secrets
*.pem
*.key
*.crt

# ❌ INSECURE: Committing .env files
git add .env # WRONG: Exposes secrets
```

### 2. Accessing Secrets Securely

```typescript
// ✅ SECURE: Load from environment, validate on startup
export function loadSecrets() {
  const requiredSecrets = [
    'DATABASE_URL',
    'JWT_SECRET',
    'API_KEY_ENCRYPTION_KEY'
  ];
  
  const missing = requiredSecrets.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    throw new Error(`Missing required secrets: ${missing.join(', ')}`);
  }
  
  // Don't log secret values
  console.log('Secrets loaded successfully');
  
  return {
    databaseUrl: process.env.DATABASE_URL,
    jwtSecret: process.env.JWT_SECRET,
    encryptionKey: process.env.API_KEY_ENCRYPTION_KEY
  };
}

// ✅ SECURE: Never log sensitive values
const dbConnection = await connectDB(secrets.databaseUrl);
console.log('Connected to database'); // Good
// console.log('Connected to', secrets.databaseUrl); // BAD

// ❌ INSECURE: Hardcoding secrets
const dbUrl = 'postgresql://admin:password123@prod.db.com:5432/app';
const jwtSecret = 'super-secret-key-12345';

// ❌ INSECURE: Logging secrets
console.log('Connecting with', secrets.databaseUrl); // Exposes connection string
```

### 3. Encrypting Sensitive Data

```typescript
// ✅ SECURE: Encrypt PII before storing
import crypto from 'crypto';

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY; // 32 bytes for AES-256
const ALGORITHM = 'aes-256-gcm';

export function encryptSensitive(plaintext: string): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, Buffer.from(ENCRYPTION_KEY), iv);
  
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  const authTag = cipher.getAuthTag();
  
  // Format: iv:encrypted:authTag
  return `${iv.toString('hex')}:${encrypted}:${authTag.toString('hex')}`;
}

export function decryptSensitive(encrypted: string): string {
  const [ivHex, encryptedHex, authTagHex] = encrypted.split(':');
  
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, Buffer.from(ENCRYPTION_KEY), iv);
  
  decipher.setAuthTag(authTag);
  
  let plaintext = decipher.update(encryptedHex, 'hex', 'utf8');
  plaintext += decipher.final('utf8');
  
  return plaintext;
}

// Usage
const userEmail = 'user@example.com';
const encrypted = encryptSensitive(userEmail);
await db.user.create({
  email: encrypted,
  emailEncrypted: true
});

// ❌ INSECURE: Storing PII in plaintext
await db.user.create({
  email: userEmail, // Plain text - bad
  phone: phone // Plain text - bad
});
```

### 4. API Key Generation

```typescript
// ✅ SECURE: Generate strong random API keys
import { randomBytes } from 'crypto';

export function generateApiKey(): { key: string; hash: string } {
  // 32 bytes = 256-bit key, encoded as base64 = 44 characters
  const key = randomBytes(32).toString('base64');
  
  // Hash the key for storage (one-way function)
  const hash = crypto
    .createHash('sha256')
    .update(key)
    .digest('hex');
  
  return { key, hash };
}

// Usage - return key to user once, store hash in database
app.post('/api-keys', async (request, reply) => {
  const user = await request.user;
  
  const { key, hash } = generateApiKey();
  
  await db.apiKey.create({
    userId: user.id,
    hash, // Store hash only
    expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), // 90 days
    createdAt: new Date(),
    lastUsedAt: null
  });
  
  return {
    key, // Return to user (only shown once)
    note: 'Save this key somewhere safe. You will not see it again.'
  };
});

// ❌ INSECURE: Storing plain API keys
await db.apiKey.create({
  userId: user.id,
  key: apiKey, // WRONG: Storing plain text
  createdAt: new Date()
});
```

---

## Secure Logging

### 1. What to Log

```typescript
// ✅ SECURE: Log security-relevant events
await auditLog.create({
  timestamp: new Date(),
  userId: user.id,
  action: 'API_AUTHENTICATION_SUCCESS',
  resource: 'api_key',
  details: {
    ipAddress: request.ip,
    userAgent: request.headers['user-agent']
  },
  status: 'SUCCESS'
});

// ✅ SECURE: Log suspicious activity
await auditLog.create({
  timestamp: new Date(),
  userId: user.id,
  action: 'MULTIPLE_FAILED_LOGIN_ATTEMPTS',
  resource: 'user_account',
  details: {
    attemptCount: 5,
    ipAddress: request.ip,
    window: '15 minutes'
  },
  severity: 'HIGH',
  status: 'FLAGGED'
});

// ✅ SECURE: Log access to sensitive data
await auditLog.create({
  timestamp: new Date(),
  userId: user.id,
  action: 'EXPORT_CREDITS_DATA',
  resource: 'credit_export',
  details: {
    recordCount: 5000,
    format: 'CSV'
  },
  status: 'SUCCESS'
});
```

### 2. What NOT to Log

```typescript
// ❌ INSECURE: Don't log passwords or secrets
logger.info(`User login: ${email}:${password}`);

// ❌ INSECURE: Don't log full credit card numbers
logger.info(`Payment: ${creditCardNumber}`);

// ❌ INSECURE: Don't log full API keys
logger.info(`API Key: ${apiKey}`);

// ❌ INSECURE: Don't log PII unnecessarily
logger.info(`User data: ${JSON.stringify(user)}`);

// ✅ SECURE: Log only what's needed
logger.info(`User authentication`, {
  userId: user.id,
  method: 'oauth',
  timestamp: new Date()
});
```

### 3. Structured Logging

```typescript
// ✅ SECURE: Use structured logging (JSON format)
import pino from 'pino';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true
    }
  }
});

// Log with structured fields
logger.info({
  action: 'CREDIT_TRANSFER',
  fromUser: user.id,
  toUser: recipient.id,
  amount: 500,
  timestamp: new Date(),
  status: 'SUCCESS'
});

// Output:
// {
//   "level": 30,
//   "time": 1693273200000,
//   "action": "CREDIT_TRANSFER",
//   "fromUser": "USER-123",
//   "toUser": "USER-456",
//   "amount": 500,
//   "status": "SUCCESS"
// }

// ❌ INSECURE: Unstructured logging
console.log('Transfer 500 credits from USER-123 to USER-456');
```

### 4. Log Redaction

```typescript
// ✅ SECURE: Redact sensitive information in logs
function redactSensitiveData(obj: any): any {
  const sensitiveFields = ['password', 'apiKey', 'secret', 'token', 'email', 'phone'];
  
  return Object.keys(obj).reduce((acc, key) => {
    if (sensitiveFields.includes(key.toLowerCase())) {
      acc[key] = '[REDACTED]';
    } else if (typeof obj[key] === 'object') {
      acc[key] = redactSensitiveData(obj[key]);
    } else {
      acc[key] = obj[key];
    }
    return acc;
  }, {});
}

// Usage
logger.info('User created', redactSensitiveData(userData));

// ❌ INSECURE: No redaction
logger.info('User created', userData); // Includes password, email, etc.
```

---

## Common Vulnerabilities

### 1. Broken Authentication

**Vulnerability**: Weak password policies, session fixation, credential stuffing

```typescript
// ✅ SECURE: Strong password requirements
import { createPasswordHasher } from 'argon2';

const hasher = createPasswordHasher();

export async function validatePassword(password: string): Promise<void> {
  const requirements = {
    minLength: 12,
    hasUppercase: /[A-Z]/.test(password),
    hasLowercase: /[a-z]/.test(password),
    hasNumbers: /\d/.test(password),
    hasSpecial: /[!@#$%^&*]/.test(password)
  };
  
  if (password.length < requirements.minLength) {
    throw new Error('Password must be at least 12 characters');
  }
  if (!requirements.hasUppercase || !requirements.hasLowercase) {
    throw new Error('Password must contain uppercase and lowercase letters');
  }
  if (!requirements.hasNumbers) {
    throw new Error('Password must contain numbers');
  }
  if (!requirements.hasSpecial) {
    throw new Error('Password must contain special characters');
  }
}

export async function hashPassword(password: string): Promise<string> {
  return hasher.hash(password);
}

// ✅ SECURE: Compare hashes properly
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  try {
    return await hasher.verify(hash, password);
  } catch {
    return false; // Hash comparison failed
  }
}

// ❌ INSECURE: Weak passwords allowed
app.post('/register', async (request, reply) => {
  if (password.length < 6) {
    throw new Error('Password too short'); // Weak minimum
  }
  // No character requirements
  const hash = crypto.md5(password); // Wrong algorithm
});
```

### 2. Injection Attacks

**Vulnerability**: SQL injection, command injection, LDAP injection

```typescript
// ✅ SECURE: Parameterized queries
const results = await db.project.findMany({
  where: {
    name: {
      contains: userSearchQuery // Properly parameterized by ORM
    }
  }
});

// ✅ SECURE: Escape command-line arguments
import { exec } from 'child_process';
import shellescape from 'shell-escape';

const args = [userInput]; // Could contain: '; rm -rf /'
const command = `ls ${shellescape(args)}`; // Properly escaped

exec(command, (error, stdout) => {
  // Safe execution
});

// ❌ INSECURE: String concatenation
const query = `SELECT * FROM projects WHERE name = '${userInput}'`;
// Vulnerable to SQL injection

const command = `ls ${userInput}`; // Vulnerable to command injection
exec(command);
```

### 3. Sensitive Data Exposure

**Vulnerability**: Unencrypted data in transit or at rest, exposed in logs

```typescript
// ✅ SECURE: Encrypt data at rest
import { encrypt, decrypt } from 'simple-crypto-js';

const userSensitiveData = {
  ssn: encrypt('123-45-6789'),
  bankAccount: encrypt('9876543210'),
  medicalRecords: encrypt('[...]')
};

await db.user.update({
  where: { id: userId },
  data: userSensitiveData
});

// ✅ SECURE: HTTPS for data in transit
app.register(require('@fastify/helmet'), {
  // Enforces HTTPS
  hsts: {
    maxAge: 31536000, // 1 year
    includeSubDomains: true,
    preload: true
  }
});

// ✅ SECURE: No sensitive data in URLs
// Good:
POST /api/v1/users/profile
{
  "email": "user@example.com"
}

// Bad:
GET /api/v1/users?email=user@example.com&password=secret123

// ❌ INSECURE: HTTP without encryption
// Client data transmitted unencrypted

// ❌ INSECURE: Storing plaintext in logs
logger.info(`SSN: ${ssn}`);
```

### 4. Broken Access Control

**Vulnerability**: Users can access/modify data they shouldn't

```typescript
// ✅ SECURE: Verify ownership before action
app.delete('/projects/:id', async (request, reply) => {
  const projectId = request.params.id;
  const userId = request.user.id;
  
  // Check ownership
  const project = await db.project.findFirst({
    where: { id: projectId, ownerId: userId }
  });
  
  if (!project) {
    throw new ForbiddenError('Project not found or access denied');
  }
  
  await db.project.delete({ where: { id: projectId } });
});

// ❌ INSECURE: No ownership check
app.delete('/projects/:id', async (request, reply) => {
  const projectId = request.params.id;
  
  // Anyone can delete any project
  await db.project.delete({ where: { id: projectId } });
});
```

### 5. Security Misconfiguration

**Vulnerability**: Debug mode on production, default credentials, unnecessary features enabled

```typescript
// ✅ SECURE: Environment-specific configuration
const config = {
  production: {
    debug: false,
    logLevel: 'error',
    cookieSecure: true,
    corsOrigins: ['https://app.carbonledger.io'],
    rateLimitPerMinute: 60
  },
  development: {
    debug: true,
    logLevel: 'debug',
    cookieSecure: false,
    corsOrigins: ['localhost:3000', 'localhost:3001'],
    rateLimitPerMinute: 1000
  }
};

const env = process.env.NODE_ENV || 'development';
const activeConfig = config[env];

app.register(require('@fastify/cors'), {
  origin: activeConfig.corsOrigins
});

// ✅ SECURE: Disable unnecessary features
app.register(require('@fastify/swagger'), {
  // Only in development
  exposeRoute: process.env.NODE_ENV === 'development'
});

// ❌ INSECURE: Swagger exposed in production
app.register(require('@fastify/swagger'), {
  exposeRoute: true // Exposes API documentation to everyone
});

// ❌ INSECURE: Default credentials
const dbPassword = 'admin'; // Never change it
```

---

## Secure Code Examples

### Example 1: Secure API Endpoint

```typescript
// ✅ SECURE: Complete example with all best practices
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';

// 1. Input validation schema
const RetireCreditsSchema = z.object({
  creditId: z.string().regex(/^CREDIT-\d{4}-\d{6}$/),
  quantity: z.number().positive().max(1_000_000),
  beneficiary: z.string().min(3).max(255),
  reason: z.string().min(10).max(1000),
  mfaToken: z.string() // MFA verification
});

// 2. Secure endpoint
export async function registerRetireEndpoint(app: FastifyInstance) {
  app.post<{ Body: typeof RetireCreditsSchema.T }>(
    '/api/v1/credits/retire',
    {
      // 3. Authentication & Authorization
      preHandler: [
        async (request, reply) => {
          const user = await validateApiKey(request);
          request.user = user;
        },
        async (request, reply) => {
          const permission = await checkPermission(request.user, 'retire:credits');
          if (!permission) {
            await auditLog.create({
              userId: request.user.id,
              action: 'UNAUTHORIZED_RETIRE_ATTEMPT',
              resource: 'credits',
              status: 'DENIED'
            });
            throw new ForbiddenError('Permission denied');
          }
        }
      ]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        // 4. Input validation
        const validatedInput = RetireCreditsSchema.parse(request.body);
        
        // 5. Verify MFA
        const mfaValid = await verifyMFAToken(
          request.user.id,
          validatedInput.mfaToken
        );
        if (!mfaValid) {
          throw new UnauthorizedError('MFA verification failed');
        }
        
        // 6. Ownership verification
        const credit = await db.credit.findUnique({
          where: { id: validatedInput.creditId },
          select: { ownerId: true, available: true, state: true }
        });
        
        if (!credit || credit.ownerId !== request.user.id) {
          throw new ForbiddenError('Credit not found or access denied');
        }
        
        // 7. Business logic validation
        if (credit.available < validatedInput.quantity) {
          throw new ValidationError(
            'Insufficient available balance',
            { available: credit.available, requested: validatedInput.quantity }
          );
        }
        
        if (credit.state !== 'ACTIVE') {
          throw new ValidationError('Credit cannot be retired in current state', {
            state: credit.state,
            allowed: ['ACTIVE']
          });
        }
        
        // 8. Execute with transaction
        const retirement = await db.$transaction(async (tx) => {
          // Deduct balance
          await tx.credit.update({
            where: { id: validatedInput.creditId },
            data: {
              available: { decrement: validatedInput.quantity },
              retired: { increment: validatedInput.quantity },
              state: 'RETIRED'
            }
          });
          
          // Create ledger entry
          const ledgerEntry = await tx.ledger.create({
            data: {
              userId: request.user.id,
              creditId: validatedInput.creditId,
              type: 'RETIREMENT',
              amount: -validatedInput.quantity,
              beneficiary: validatedInput.beneficiary,
              reason: validatedInput.reason,
              timestamp: new Date()
            }
          });
          
          // Create blockchain transaction
          const txHash = await executeBlockchainRetirement({
            creditId: validatedInput.creditId,
            quantity: validatedInput.quantity,
            beneficiary: validatedInput.beneficiary,
            userAddress: request.user.walletAddress
          });
          
          return {
            retirementId: ledgerEntry.id,
            txHash,
            status: 'SUCCESS'
          };
        });
        
        // 9. Audit logging
        await auditLog.create({
          userId: request.user.id,
          action: 'CREDIT_RETIREMENT',
          resource: `credit:${validatedInput.creditId}`,
          details: {
            quantity: validatedInput.quantity,
            beneficiary: validatedInput.beneficiary,
            txHash: retirement.txHash
          },
          status: 'SUCCESS',
          timestamp: new Date()
        });
        
        // 10. Return success response (no secrets exposed)
        return reply.status(200).send({
          retirementId: retirement.retirementId,
          status: 'SUCCESS',
          message: 'Credits retired successfully'
        });
        
      } catch (error) {
        // 11. Secure error handling (no sensitive info exposed)
        if (error instanceof ValidationError) {
          await auditLog.create({
            userId: request.user?.id,
            action: 'CREDIT_RETIREMENT_VALIDATION_FAILED',
            status: 'FAILED',
            reason: error.message
          });
          
          return reply.status(400).send({
            error: 'Validation failed',
            message: error.message
          });
        }
        
        if (error instanceof ForbiddenError) {
          return reply.status(403).send({
            error: 'Forbidden',
            message: 'You do not have permission to perform this action'
          });
        }
        
        // Log unexpected errors but don't expose details
        logger.error('Unexpected error in retire endpoint', {
          error: error.message,
          userId: request.user?.id,
          creditId: request.body?.creditId
        });
        
        return reply.status(500).send({
          error: 'Internal server error',
          message: 'An unexpected error occurred'
        });
      }
    }
  );
}
```

---

## Anti-Patterns to Avoid

### ❌ Anti-Pattern 1: Magic Numbers

```typescript
// ❌ INSECURE: What does 86400 mean?
const sessionTimeout = 86400; // Developer months from now: "What was this for?"
const maxLoginAttempts = 5;
const lockoutDuration = 900;

// ✅ SECURE: Named constants
const SESSION_TIMEOUT_SECONDS = 24 * 60 * 60; // 24 hours
const MAX_LOGIN_ATTEMPTS = 5;
const ACCOUNT_LOCKOUT_DURATION_SECONDS = 15 * 60; // 15 minutes
```

### ❌ Anti-Pattern 2: Overly Permissive CORS

```typescript
// ❌ INSECURE: Accept requests from anywhere
app.register(require('@fastify/cors'), {
  origin: '*'
});

// ✅ SECURE: Explicit allowed origins
app.register(require('@fastify/cors'), {
  origin: ['https://app.carbonledger.io', 'https://dashboard.carbonledger.io'],
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true
});
```

### ❌ Anti-Pattern 3: Trusting External Input

```typescript
// ❌ INSECURE: Trust user's ID from URL
app.get('/users/:userId/profile', async (request, reply) => {
  const userId = request.params.userId;
  const profile = await db.user.findUnique({ where: { id: userId } });
  return profile; // Any user can view any profile
});

// ✅ SECURE: Use authenticated user's ID
app.get('/users/profile', async (request, reply) => {
  const userId = request.user.id;
  const profile = await db.user.findUnique({ where: { id: userId } });
  return profile; // Can only view own profile
});
```

### ❌ Anti-Pattern 4: Catching All Errors Silently

```typescript
// ❌ INSECURE: Silently ignore all errors
try {
  await validateTransaction(txData);
} catch (error) {
  // Do nothing - just let it fail silently
}

// ✅ SECURE: Handle specific errors appropriately
try {
  await validateTransaction(txData);
} catch (error) {
  if (error instanceof InvalidTransactionError) {
    logger.warn('Invalid transaction', { error: error.message });
    throw error; // Re-throw for caller to handle
  }
  
  // Unexpected error - log and escalate
  logger.error('Unexpected error validating transaction', { error });
  throw new InternalError('Transaction validation failed');
}
```

---

## Security Checklist

### Pre-Deployment Security Review

- [ ] **Authentication**
  - [ ] API keys are hashed in database
  - [ ] JWT tokens have short expiration (≤1 hour)
  - [ ] Refresh tokens are rotated
  - [ ] MFA is enforced for sensitive operations
  - [ ] No default credentials in code

- [ ] **Authorization**
  - [ ] RBAC implemented and tested
  - [ ] Ownership verification on all mutations
  - [ ] No hardcoded permissions
  - [ ] Rate limiting in place

- [ ] **Input Validation**
  - [ ] All user input validated with schema
  - [ ] Whitelisting used, not blacklisting
  - [ ] File uploads restricted by type/size
  - [ ] No SQL injection vulnerabilities

- [ ] **Data Protection**
  - [ ] Sensitive data encrypted at rest
  - [ ] HTTPS enforced for all endpoints
  - [ ] Secrets in environment variables
  - [ ] No secrets in logs or error messages
  - [ ] GDPR/privacy requirements met

- [ ] **Logging & Monitoring**
  - [ ] Security events logged with timestamps
  - [ ] Audit trail immutable
  - [ ] No PII in logs
  - [ ] Alerts set up for anomalies
  - [ ] Log retention policy defined

- [ ] **Dependencies**
  - [ ] All dependencies scanned for vulnerabilities
  - [ ] No known CVEs in production
  - [ ] Dependency updates tested
  - [ ] Transitive dependencies reviewed

- [ ] **Error Handling**
  - [ ] Generic error messages to users
  - [ ] Detailed errors in logs only
  - [ ] No stack traces exposed
  - [ ] No information leakage in errors

- [ ] **Infrastructure**
  - [ ] Secrets not in code repository
  - [ ] Database access restricted by IP/VPN
  - [ ] Backup encryption enabled
  - [ ] SSL certificates valid & non-expired
  - [ ] Security headers set

- [ ] **Code Quality**
  - [ ] Security code review completed
  - [ ] No hardcoded secrets found
  - [ ] Complexity reviewed (security issues in complex code)
  - [ ] Common vulnerabilities (OWASP Top 10) checked

---

**Document Version**: 1.0  
**Last Updated**: 2026-08-29  
**Next Review**: 2026-09-29  
**Author**: Security Team
