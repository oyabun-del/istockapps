import type { ApiFailure, ApiSuccess, ErrorCode } from '@istock/shared';

export function ok<T>(data: T): ApiSuccess<T> {
  return { success: true, data, error: null };
}

export function fail(code: ErrorCode, message: string): ApiFailure {
  return { success: false, data: null, error: { code, message } };
}
