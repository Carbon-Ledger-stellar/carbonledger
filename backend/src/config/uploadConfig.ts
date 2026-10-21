import path from 'path';

export interface AllowedUploadType {
  /** Canonical MIME type accepted for documentation uploads. */
  mime: string;
  /** File extensions (lowercase, without dot) that map to this MIME type. */
  extensions: string[];
  /** Leading magic-byte signatures that identify this type. */
  magicBytes: Buffer[];
}

/**
 * Whitelist of MIME types accepted for project documentation uploads.
 * Each entry pairs the declared MIME type with the extensions we allow and
 * the magic-byte signatures used to verify the actual file content.
 */
export const ALLOWED_UPLOAD_TYPES: AllowedUploadType[] = [
  {
    mime: 'application/pdf',
    extensions: ['pdf'],
    magicBytes: [Buffer.from([0x25, 0x50, 0x44, 0x46])], // %PDF
  },
  {
    mime: 'image/png',
    extensions: ['png'],
    magicBytes: [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
  },
  {
    mime: 'image/jpeg',
    extensions: ['jpg', 'jpeg'],
    magicBytes: [Buffer.from([0xff, 0xd8, 0xff])],
  },
  {
    mime: 'text/plain',
    extensions: ['txt'],
    magicBytes: [], // plain text has no reliable signature; extension + MIME checked
  },
  {
    mime: 'text/markdown',
    extensions: ['md', 'markdown'],
    magicBytes: [],
  },
];

/** Maximum allowed upload size for documentation files (10 MiB). */
export const MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024;

/** Flat list of allowed MIME types. */
export const ALLOWED_MIME_TYPES: string[] = ALLOWED_UPLOAD_TYPES.map((t) => t.mime);

/** Flat list of allowed extensions (lowercase, without dot). */
export const ALLOWED_EXTENSIONS: string[] = ALLOWED_UPLOAD_TYPES.flatMap((t) => t.extensions);

export interface UploadValidationInput {
  /** Original file name, used to derive the extension. */
  filename: string;
  /** Declared MIME type from the client (untrusted). */
  mimetype: string;
  /** File size in bytes. */
  size: number;
  /** Leading bytes of the file content for magic-byte verification. */
  buffer?: Buffer;
}

export interface UploadValidationResult {
  valid: boolean;
  /** Human-readable reason when validation fails. */
  reason?: string;
}

function getExtension(filename: string): string {
  return path.extname(filename).replace(/^\./, '').toLowerCase();
}

function matchesMagicBytes(buffer: Buffer, signatures: Buffer[]): boolean {
  if (signatures.length === 0) {
    return true;
  }
  return signatures.some(
    (sig) => buffer.length >= sig.length && buffer.subarray(0, sig.length).equals(sig),
  );
}

/**
 * Validate a documentation upload against the MIME whitelist, size limit and
 * magic-byte signatures. Returns a result object rather than throwing so
 * callers can surface a consistent error response.
 */
export function validateUpload(input: UploadValidationInput): UploadValidationResult {
  const { filename, mimetype, size, buffer } = input;

  if (typeof size !== 'number' || size <= 0) {
    return { valid: false, reason: 'File is empty' };
  }

  if (size > MAX_UPLOAD_SIZE_BYTES) {
    return {
      valid: false,
      reason: `File exceeds maximum size of ${MAX_UPLOAD_SIZE_BYTES} bytes`,
    };
  }

  const extension = getExtension(filename);
  if (!extension || !ALLOWED_EXTENSIONS.includes(extension)) {
    return { valid: false, reason: `File extension .${extension || '(none)'} is not allowed` };
  }

  const normalizedMime = (mimetype || '').toLowerCase();
  const typeConfig = ALLOWED_UPLOAD_TYPES.find((t) => t.mime === normalizedMime);
  if (!typeConfig) {
    return { valid: false, reason: `MIME type ${mimetype || '(none)'} is not allowed` };
  }

  if (!typeConfig.extensions.includes(extension)) {
    return {
      valid: false,
      reason: `Extension .${extension} does not match declared MIME type ${typeConfig.mime}`,
    };
  }

  if (typeConfig.magicBytes.length > 0) {
    if (!buffer || buffer.length === 0) {
      return { valid: false, reason: 'File content is required for magic-byte validation' };
    }
    if (!matchesMagicBytes(buffer, typeConfig.magicBytes)) {
      return {
        valid: false,
        reason: `File content does not match expected signature for ${typeConfig.mime}`,
      };
    }
  }

  return { valid: true };
}
