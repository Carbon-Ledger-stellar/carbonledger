export function sanitizeUserText(value: unknown, maxLength = 1024): string | null {
  if (value == null) return null;

  if (typeof value !== "string") {
    value = String(value);
  }

  const normalized = (value as string)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\b(?:javascript|vbscript|data):/gi, "")
    .replace(/\bon\w+\s*=/gi, " ")
    .replace(/[<>"]+/g, "")
    .trim();

  return normalized.length > 0 ? normalized.slice(0, maxLength) : null;
}

export function escapeForOutput(value: unknown): string | null {
  if (value == null) return null;
  const text = typeof value === "string" ? value : String(value);

  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function sanitizeProjectForResponse<T extends Record<string, unknown>>(project: T): T {
  if (!project || typeof project !== "object") return project;

  const copy = { ...project } as Record<string, unknown>;

  if (typeof copy.name === "string") {
    copy.name = escapeForOutput(sanitizeUserText(copy.name) ?? "") ?? "";
  }
  if (typeof copy.description === "string") {
    copy.description = escapeForOutput(sanitizeUserText(copy.description) ?? "") ?? "";
  }

  return copy as T;
}

export function sanitizeRetirementForResponse<T extends Record<string, unknown>>(retirement: T): T {
  if (!retirement || typeof retirement !== "object") return retirement;

  const copy = { ...retirement } as Record<string, unknown>;

  if (typeof copy.beneficiary === "string") {
    copy.beneficiary = escapeForOutput(sanitizeUserText(copy.beneficiary) ?? "") ?? "";
  }
  if (typeof copy.retirementReason === "string") {
    copy.retirementReason = escapeForOutput(sanitizeUserText(copy.retirementReason) ?? "") ?? "";
  }

  return copy as T;
}

export function sanitizeProjectPayload<T extends Record<string, unknown>>(payload: T): T {
  if (!payload || typeof payload !== "object") return payload;

  const copy = { ...payload } as Record<string, unknown>;

  for (const field of ["name", "description", "methodology", "country", "projectType", "ownerAddress", "verifierAddress", "projectId"]) {
    if (typeof copy[field] === "string") {
      const sanitized = sanitizeUserText(copy[field], 1024);
      copy[field] = sanitized ?? "";
    }
  }

  return copy as T;
}

export function sanitizeRetirementPayload<T extends Record<string, unknown>>(payload: T): T {
  if (!payload || typeof payload !== "object") return payload;

  const copy = { ...payload } as Record<string, unknown>;

  for (const field of ["beneficiary", "retirementReason", "batchId", "projectId", "retiredBy", "txHash"]) {
    if (typeof copy[field] === "string") {
      const sanitized = sanitizeUserText(copy[field], 1024);
      copy[field] = sanitized ?? "";
    }
  }

  return copy as T;
}
