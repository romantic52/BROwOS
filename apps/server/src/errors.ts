/** Errors safe to return to an API client. Never include secrets or raw browser logs. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function asApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  return new ApiError(502, 'BROWSER_ERROR', 'The browser could not complete this operation.');
}
