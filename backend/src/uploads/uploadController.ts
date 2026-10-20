import { Request, Response } from 'express';
import multer from 'multer';

// Allowed MIME types for project documentation uploads.
export const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'text/csv',
  'image/png',
  'image/jpeg',
];

// Maximum upload size: 25 MB.
export const MAX_UPLOAD_SIZE_BYTES = 25 * 1024 * 1024;

// Magic-byte signatures keyed by the MIME types we accept. Each entry lists
// one or more byte prefixes that a file of that type must start with.
const MAGIC_BYTES: Record<string, number[][]> = {
  'application/pdf': [[0x25, 0x50, 0x44, 0x46]], // %PDF
  'application/msword': [[0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': [
    [0x50, 0x4b, 0x03, 0x04], // PK.. (zip container)
  ],
  'application/vnd.ms-excel': [[0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': [
    [0x50, 0x4b, 0x03, 0x04],
  ],
  'image/png': [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  'image/jpeg': [[0xff, 0xd8, 0xff]],
};

// Text-based types have no reliable magic bytes; validate they are decodable
// text instead of matching a binary signature.
const TEXT_MIME_TYPES = new Set(['text/plain', 'text/csv']);

function startsWithBytes(buffer: Buffer, prefix: number[]): boolean {
  if (buffer.length < prefix.length) {
    return false;
  }
  for (let i = 0; i < prefix.length; i += 1) {
    if (buffer[i] !== prefix[i]) {
      return false;
    }
  }
  return true;
}

function looksLikeText(buffer: Buffer): boolean {
  // Reject files containing NUL bytes, which indicate binary content.
  return !buffer.includes(0x00);
}

/**
 * Validates a file's declared MIME type, size, and actual content
 * (magic bytes) against the upload policy.
 * Returns an error message when invalid, or null when the file is acceptable.
 */
export function validateUpload(
  file: { mimetype: string; size: number; buffer: Buffer },
): string | null {
  if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    return `Unsupported file type: ${file.mimetype}`;
  }

  if (file.size > MAX_UPLOAD_SIZE_BYTES) {
    return `File exceeds maximum size of ${MAX_UPLOAD_SIZE_BYTES} bytes`;
  }

  if (file.size === 0 || file.buffer.length === 0) {
    return 'File is empty';
  }

  if (TEXT_MIME_TYPES.has(file.mimetype)) {
    if (!looksLikeText(file.buffer)) {
      return 'File content does not match declared type';
    }
    return null;
  }

  const signatures = MAGIC_BYTES[file.mimetype];
  if (!signatures) {
    return `Unsupported file type: ${file.mimetype}`;
  }

  const matches = signatures.some((prefix) => startsWithBytes(file.buffer, prefix));
  if (!matches) {
    return 'File content does not match declared type';
  }

  return null;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_SIZE_BYTES },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      cb(new Error(`Unsupported file type: ${file.mimetype}`));
      return;
    }
    cb(null, true);
  },
});

export const uploadMiddleware = upload.single('file');

export async function uploadDocument(req: Request, res: Response): Promise<void> {
  const file = req.file;

  if (!file) {
    res.status(400).json({ error: 'No file provided' });
    return;
  }

  const validationError = validateUpload({
    mimetype: file.mimetype,
    size: file.size,
    buffer: file.buffer,
  });

  if (validationError) {
    res.status(400).json({ error: validationError });
    return;
  }

  // Persistence of the validated file is handled downstream.
  res.status(201).json({
    filename: file.originalname,
    mimetype: file.mimetype,
    size: file.size,
  });
}
