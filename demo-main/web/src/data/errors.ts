export type ApiErrorCode = 'not_found' | 'invalid' | 'conflict' | 'network' | 'not_implemented';

/** One problem with a request body (validation). */
export interface FieldError {
  field: string;
  message: string;
}

/** A failed data call. Check `code` (not the message) to decide what to do. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: ApiErrorCode = codeForStatus(status),
    /** Every field problem, for validation errors. */
    readonly details: FieldError[] = [],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function codeForStatus(status: number): ApiErrorCode {
  if (status === 404) return 'not_found';
  if (status === 409) return 'conflict';
  if (status === 501) return 'not_implemented';
  if (status === 0 || status >= 500) return 'network';
  return 'invalid';
}

export const notFound = (message: string) => new ApiError(message, 404, 'not_found');
export const conflict = (message: string) => new ApiError(message, 409, 'conflict');
export const notImplemented = (message: string) => new ApiError(message, 501, 'not_implemented');
export function invalid(message: string, details: FieldError[] = []): ApiError {
  return new ApiError(message, 400, 'invalid', details);
}
