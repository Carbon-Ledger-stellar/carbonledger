import {
  IsSafeStringConstraint,
  IsTxHashConstraint,
  IsSafeUrlConstraint,
  IsIpfsUrlConstraint,
  IsNonNegativeAmountConstraint,
  IsMethodologyIdConstraint,
  IsCarbonEmailConstraint,
} from './common-format.validator';

// Helper to run the validate method without needing ValidationArguments
function validate<T extends { validate(v: unknown): boolean }>(
  ConstraintClass: new () => T,
  value: unknown,
): boolean {
  return new ConstraintClass().validate(value);
}

describe('IsSafeStringConstraint', () => {
  const c = new IsSafeStringConstraint();

  it('accepts plain text', () => {
    expect(c.validate('Hello, World!')).toBe(true);
  });

  it('accepts text with numbers and punctuation', () => {
    expect(c.validate('Project ID: 1234, cost: $50.00')).toBe(true);
  });

  it('rejects a <script> tag', () => {
    expect(c.validate('<script>alert(1)</script>')).toBe(false);
  });

  it('rejects javascript: URI', () => {
    expect(c.validate('javascript:alert(1)')).toBe(false);
  });

  it('rejects vbscript: URI', () => {
    expect(c.validate('vbscript:MsgBox(1)')).toBe(false);
  });

  it('rejects event handler attributes', () => {
    expect(c.validate('onclick=doEvil()')).toBe(false);
  });

  it('rejects onerror handler', () => {
    expect(c.validate('<img onerror=alert(1) src=x>')).toBe(false);
  });

  it('rejects HTML numeric entity encoding', () => {
    expect(c.validate('&#x3C;script&#x3E;')).toBe(false);
  });

  it('rejects CSS expression()', () => {
    expect(c.validate('expression(alert(1))')).toBe(false);
  });

  it('rejects non-string values', () => {
    expect(c.validate(123)).toBe(false);
    expect(c.validate(null)).toBe(false);
    expect(c.validate(undefined)).toBe(false);
  });
});

describe('IsTxHashConstraint', () => {
  const c = new IsTxHashConstraint();

  it('accepts a valid 64-char lowercase hex hash', () => {
    expect(c.validate('a'.repeat(64))).toBe(true);
  });

  it('accepts mixed-case hex', () => {
    expect(c.validate('A'.repeat(64))).toBe(true);
    expect(c.validate('aAbBcCdDeEfF' + '0'.repeat(52))).toBe(true);
  });

  it('rejects a hash that is too short', () => {
    expect(c.validate('abc123')).toBe(false);
  });

  it('rejects a hash that is too long', () => {
    expect(c.validate('a'.repeat(65))).toBe(false);
  });

  it('rejects non-hex characters', () => {
    expect(c.validate('g'.repeat(64))).toBe(false);
    expect(c.validate('z'.repeat(64))).toBe(false);
  });

  it('rejects non-string values', () => {
    expect(c.validate(123)).toBe(false);
    expect(c.validate(null)).toBe(false);
  });
});

describe('IsSafeUrlConstraint', () => {
  const c = new IsSafeUrlConstraint();

  it('accepts https URLs', () => {
    expect(c.validate('https://example.com/path?q=1')).toBe(true);
  });

  it('accepts http URLs', () => {
    expect(c.validate('http://localhost:3001/api')).toBe(true);
  });

  it('rejects javascript: URLs', () => {
    expect(c.validate('javascript:alert(1)')).toBe(false);
  });

  it('rejects data: URLs', () => {
    expect(c.validate('data:text/html,<script>alert(1)</script>')).toBe(false);
  });

  it('rejects ftp: URLs', () => {
    expect(c.validate('ftp://files.example.com/file.txt')).toBe(false);
  });

  it('rejects vbscript: URLs', () => {
    expect(c.validate('vbscript:MsgBox("XSS")')).toBe(false);
  });

  it('rejects file: URLs', () => {
    expect(c.validate('file:///etc/passwd')).toBe(false);
  });

  it('rejects bare strings without scheme', () => {
    expect(c.validate('example.com')).toBe(false);
  });

  it('rejects non-string values', () => {
    expect(c.validate(null)).toBe(false);
    expect(c.validate(42)).toBe(false);
  });
});

describe('IsIpfsUrlConstraint', () => {
  const c = new IsIpfsUrlConstraint();

  it('accepts ipfs:// URLs', () => {
    expect(
      c.validate('ipfs://QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG'),
    ).toBe(true);
  });

  it('accepts https://ipfs.io/ipfs/ URLs', () => {
    expect(
      c.validate(
        'https://ipfs.io/ipfs/QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG',
      ),
    ).toBe(true);
  });

  it('rejects https URLs on other hosts', () => {
    expect(
      c.validate(
        'https://gateway.pinata.cloud/ipfs/QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG',
      ),
    ).toBe(false);
  });

  it('rejects plain https:// URLs', () => {
    expect(c.validate('https://example.com')).toBe(false);
  });

  it('rejects non-string values', () => {
    expect(c.validate(null)).toBe(false);
  });
});

describe('IsNonNegativeAmountConstraint', () => {
  const c = new IsNonNegativeAmountConstraint();

  it('accepts zero', () => {
    expect(c.validate(0)).toBe(true);
  });

  it('accepts positive integers', () => {
    expect(c.validate(100)).toBe(true);
  });

  it('accepts amounts with 1 decimal place', () => {
    expect(c.validate(10.5)).toBe(true);
  });

  it('accepts amounts with 2 decimal places', () => {
    expect(c.validate(10.25)).toBe(true);
  });

  it('rejects amounts with more than 2 decimal places', () => {
    expect(c.validate(10.123)).toBe(false);
  });

  it('rejects negative amounts', () => {
    expect(c.validate(-1)).toBe(false);
  });

  it('rejects amounts above 1 billion', () => {
    expect(c.validate(1_000_000_001)).toBe(false);
  });

  it('rejects NaN', () => {
    expect(c.validate(NaN)).toBe(false);
  });

  it('rejects non-number values', () => {
    expect(c.validate('100')).toBe(false);
    expect(c.validate(null)).toBe(false);
  });
});

describe('IsMethodologyIdConstraint', () => {
  const c = new IsMethodologyIdConstraint();

  it('accepts standard methodology IDs', () => {
    expect(c.validate('VCS-VM0007')).toBe(true);
    expect(c.validate('GS-LUF')).toBe(true);
    expect(c.validate('CDM-AR-ACM0003')).toBe(true);
  });

  it('accepts IDs with dots and slashes', () => {
    expect(c.validate('VCS/VM0007.1')).toBe(true);
  });

  it('accepts IDs with underscores', () => {
    expect(c.validate('REDD_PLUS')).toBe(true);
  });

  it('rejects empty string', () => {
    expect(c.validate('')).toBe(false);
  });

  it('rejects IDs over 64 characters', () => {
    expect(c.validate('A'.repeat(65))).toBe(false);
  });

  it('rejects IDs with spaces', () => {
    expect(c.validate('VCS VM0007')).toBe(false);
  });

  it('rejects IDs with special characters like < > &', () => {
    expect(c.validate('<script>')).toBe(false);
    expect(c.validate('A&B')).toBe(false);
  });

  it('rejects non-string values', () => {
    expect(c.validate(null)).toBe(false);
    expect(c.validate(123)).toBe(false);
  });
});

describe('IsCarbonEmailConstraint', () => {
  const c = new IsCarbonEmailConstraint();

  it('accepts valid email addresses', () => {
    expect(c.validate('user@example.com')).toBe(true);
    expect(c.validate('user.name+tag@sub.example.co.uk')).toBe(true);
    expect(c.validate('admin@carbonledger.io')).toBe(true);
  });

  it('rejects emails without @', () => {
    expect(c.validate('notanemail')).toBe(false);
  });

  it('rejects emails without domain', () => {
    expect(c.validate('user@')).toBe(false);
  });

  it('rejects emails without TLD', () => {
    expect(c.validate('user@example')).toBe(false);
  });

  it('rejects emails over 255 characters', () => {
    // local part alone is 250 chars, plus @example.com = 262 chars total
    const longLocal = 'a'.repeat(250);
    expect(c.validate(`${longLocal}@example.com`)).toBe(false);
  });

  it('rejects non-string values', () => {
    expect(c.validate(null)).toBe(false);
    expect(c.validate(123)).toBe(false);
  });
});
