"use client";

import { useCallback, useMemo, useRef, useState } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type ValidationRuleType = "required" | "email" | "numeric" | "url" | "ipfsCid";

export interface ValidationRule {
  type: ValidationRuleType | "custom";
  /** Error message shown below the field when the rule fails. */
  message: string;
  /** Numeric bounds (used with `type: "numeric"`). */
  min?: number;
  max?: number;
  /** Custom validator — returns an error message or null. */
  validate?: (value: string) => string | null;
}

export type FieldRules<T> = Record<keyof T, ValidationRule[]>;

export interface UseFormValidationOptions<T> {
  /** Field rule map. */
  fields: FieldRules<T>;
  /** Debounce delay in ms for onChange validation (default 300). */
  debounceMs?: number;
}

export interface UseFormValidationReturn<T> {
  /** Current per-field error messages (empty string values are dropped). */
  errors: Partial<Record<keyof T, string>>;
  /** True when no field has an error message. */
  isValid: boolean;
  /** Validate a single field immediately (blur / submit). Returns the error message or null. */
  validateField: (field: keyof T, value: unknown) => string | null;
  /** Schedule a debounced validation for a field (change events). */
  validateFieldDebounced: (field: keyof T, value: unknown) => void;
  /** Validate every field. Returns true when the form is valid. */
  validateForm: (values: Record<keyof T, unknown>) => boolean;
  /** Clear the error message for a single field. */
  clearFieldError: (field: keyof T) => void;
  /** Set an explicit error message for a field (e.g. server/IPFS upload failures). */
  setFieldError: (field: keyof T, message: string) => void;
  /** Clear every field error. */
  clearErrors: () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared validators
// ─────────────────────────────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_RE = /^https?:\/\/[^\s]+\.[^\s]+$/i;
const IPFS_CID_RE = /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|bafy[a-zA-Z0-9]{46,})$/;

export function validateValue(value: unknown, rules: ValidationRule[]): string | null {
  const raw = value === null || value === undefined ? "" : String(value);
  const trimmed = raw.trim();

  for (const rule of rules) {
    if (rule.type === "custom" && rule.validate) {
      const customError = rule.validate(trimmed);
      if (customError) return customError;
      continue;
    }
    switch (rule.type) {
      case "required":
        if (!trimmed) return rule.message;
        break;
      case "email":
        if (trimmed && !EMAIL_RE.test(trimmed)) return rule.message;
        break;
      case "numeric": {
        if (!trimmed) break;
        const num = Number(trimmed);
        if (Number.isNaN(num)) return rule.message;
        if (rule.min !== undefined && num < rule.min) return rule.message;
        if (rule.max !== undefined && num > rule.max) return rule.message;
        break;
      }
      case "url":
        if (trimmed && !URL_RE.test(trimmed)) return rule.message;
        break;
      case "ipfsCid":
        if (trimmed && !IPFS_CID_RE.test(trimmed)) return rule.message;
        break;
      default:
        break;
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────────────────

export function useFormValidation<T extends Record<string, unknown>>(
  options: UseFormValidationOptions<T>,
): UseFormValidationReturn<T> {
  const { fields, debounceMs = 300 } = options;
  const [errors, setErrors] = useState<Partial<Record<keyof T, string>>>({});
  const timers = useRef<Partial<Record<keyof T, ReturnType<typeof setTimeout>>>>({});

  const validateField = useCallback(
    (field: keyof T, value: unknown): string | null => {
      const rules = fields[field];
      const error = rules ? validateValue(value, rules) : null;
      setErrors((prev) => {
        const next = { ...prev };
        if (error) next[field] = error;
        else delete next[field];
        return next;
      });
      return error;
    },
    [fields],
  );

  const validateFieldDebounced = useCallback(
    (field: keyof T, value: unknown) => {
      if (timers.current[field]) clearTimeout(timers.current[field]!);
      timers.current[field] = setTimeout(() => {
        validateField(field, value);
        delete timers.current[field];
      }, debounceMs);
    },
    [validateField, debounceMs],
  );

  const validateForm = useCallback(
    (values: Record<keyof T, unknown>): boolean => {
      let allValid = true;
      const next: Partial<Record<keyof T, string>> = {};
      (Object.keys(fields) as (keyof T)[]).forEach((field) => {
        const error = validateValue(values[field], fields[field]);
        if (error) {
          next[field] = error;
          allValid = false;
        }
      });
      setErrors(next);
      return allValid;
    },
    [fields],
  );

  const clearFieldError = useCallback((field: keyof T) => {
    setErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }, []);

  const setFieldError = useCallback((field: keyof T, message: string) => {
    if (!message) {
      clearFieldError(field);
      return;
    }
    setErrors((prev) => (prev[field] === message ? prev : { ...prev, [field]: message }));
  }, [clearFieldError]);

  const clearErrors = useCallback(() => setErrors({}), []);

  const isValid = useMemo(() => Object.keys(errors).length === 0, [errors]);

  return {
    errors,
    isValid,
    validateField,
    validateFieldDebounced,
    validateForm,
    clearFieldError,
    setFieldError,
    clearErrors,
  };
}