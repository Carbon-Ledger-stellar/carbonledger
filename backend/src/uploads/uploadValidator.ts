export interface UploadValidationOptions {
  maxSizeBytes?: number;
  allowedMimeTypes?: string[];
}

export interface UploadValidationResult {
  valid: boolean;
  reason?: string;
  detectedMimeType?: string;
}

const DEFAULT_MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

const DEFAULT_ALLOWED_MIME_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/csv',
  'image/png',
  'image/jpeg',
  'image/gif',
];

interface MagicSignature {
  mimeType: string;
  bytes: number[];
  offset?: number;
}

const MAGIC_SIGNATURES: MagicSignature[] = [
  { mimeType: 'application/pdf', bytes: [0x25, 0x50, 0x44, 0x46] }, // %PDF
  { mimeType: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mimeType: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { mimeType: 'image/gif', bytes: [0x47, 0x49, 0x46, 0x38] }, // GIF8
  // ZIP-based Office formats (docx/xlsx/pptx) share the PK\x03\x04 signature.
  { mimeType: 'application/zip', bytes: [0x50, 0x4b, 0x03, 0x04] },
  // Legacy OLE compound files (doc/xls/ppt).
  { mimeType: 'application/x-ole-storage', bytes: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] },
];

const ZIP_BASED_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
]);

const OLE_BASED_MIME_TYPES = new Set([
  'application/msword',
  'application/vnd.ms-excel',
  'application/vnd.ms-powerpoint',
]);

function matchesSignature(buffer: Buffer, signature: MagicSignature): boolean {
  const offset = signature.offset ?? 0;
  if (buffer.length < offset + signature.bytes.length) {
    return false;
  }
  for (let i = 0; i < signature.bytes.length; i += 1) {
    if (buffer[offset + i] !== signature.bytes[i]) {
      return false;
    }
  }
  return true;
}

function isLikelyText(buffer: Buffer): boolean {
  // Treat as text if there are no NUL bytes and content is valid UTF-8-ish.
  const sample = buffer.subarray(0, Math.min(buffer.length, 1024));
  for (let i = 0; i < sample.length; i += 1) {
    if (sample[i] === 0x00) {
      return false;
    }
  }
  return true;
}

/**
 * Detect the MIME type of a buffer using magic-byte signatures.
 * Returns undefined when no known signature matches.
 */
export function detectMimeType(buffer: Buffer): string | undefined {
  for (const signature of MAGIC_SIGNATURES) {
    if (matchesSignature(buffer, signature)) {
      return signature.mimeType;
    }
  }
  if (isLikelyText(buffer)) {
    return 'text/plain';
  }
  return undefined;
}

function isDetectedTypeCompatible(declaredMimeType: string, detectedMimeType: string): boolean {
  if (declaredMimeType === detectedMimeType) {
    return true;
  }
  if (ZIP_BASED_MIME_TYPES.has(declaredMimeType) && detectedMimeType === 'application/zip') {
    return true;
  }
  if (OLE_BASED_MIME_TYPES.has(declaredMimeType) && detectedMimeType === 'application/x-ole-storage') {
    return true;
  }
  if (declaredMimeType === 'text/csv' && detectedMimeType === 'text/plain') {
    return true;
  }
  return false;
}

/**
 * Validate an uploaded documentation file against MIME whitelist, size limit,
 * and magic-byte content checks.
 */
export function validateUpload(
  buffer: Buffer,
  declaredMimeType: string,
  options: UploadValidationOptions = {},
): UploadValidationResult {
  const maxSizeBytes = options.maxSizeBytes ?? DEFAULT_MAX_SIZE_BYTES;
  const allowedMimeTypes = options.allowedMimeTypes ?? DEFAULT_ALLOWED_MIME_TYPES;

  if (!buffer || buffer.length === 0) {
    return { valid: false, reason: 'File is empty' };
  }

  if (buffer.length > maxSizeBytes) {
    return { valid: false, reason: `File exceeds maximum size of ${maxSizeBytes} bytes` };
  }

  const normalizedMimeType = (declaredMimeType || '').split(';')[0].trim().toLowerCase();

  if (!allowedMimeTypes.includes(normalizedMimeType)) {
    return { valid: false, reason: `MIME type '${normalizedMimeType}' is not allowed` };
  }

  const detectedMimeType = detectMimeType(buffer);

  if (!detectedMimeType) {
    return { valid: false, reason: 'Unable to determine file type from content' };
  }

  if (!isDetectedTypeCompatible(normalizedMimeType, detectedMimeType)) {
    return {
      valid: false,
      reason: `File content (${detectedMimeType}) does not match declared type (${normalizedMimeType})`,
      detectedMimeType,
    };
  }

  return { valid: true, detectedMimeType };
}

export const UPLOAD_MAX_SIZE_BYTES = DEFAULT_MAX_SIZE_BYTES;
export const UPLOAD_ALLOWED_MIME_TYPES = DEFAULT_ALLOWED_MIME_TYPES;
