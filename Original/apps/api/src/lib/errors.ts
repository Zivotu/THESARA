export const ERROR_MESSAGES = {
  NET_INVALID_INPUT: 'Invalid input',
  NET_EMAIL_EXISTS: 'Email already exists',
  NET_INTERNAL_ERROR: 'Internal server error',
  NET_NOT_FOUND: 'Not found',
  NET_INVALID_REQUEST: 'Invalid request',
  NET_MISSING_APP_ID: 'Missing appId',
  NET_APP_NOT_FOUND: 'App not found',
  NET_MISSING_CREATOR_UID: 'Missing creator UID',
  NET_CREATOR_NOT_FOUND: 'Creator not found',
  NET_MISSING_PRICE: 'Missing price',
  NET_UNAUTHORIZED: 'Unauthorized',
  NET_CHECKOUT_SESSION_FAILED: 'Checkout session creation failed',
  NET_MISSING_CUSTOMER: 'Missing customer',
  NET_PORTAL_SESSION_FAILED: 'Portal session creation failed',
  NET_MISSING_HANDLE: 'Missing handle',
  LLM_MISSING_API_KEY: 'Missing LLM API key',
  LLM_INVALID_JSON: 'Invalid JSON from LLM',
  LLM_UNREACHABLE: 'LLM unreachable',
  MISSING_ARTIFACT: 'Missing artifact',
  BUILD_BAD_STATE: 'Bad state',
  BUILD_BAD_PIN: 'Bad pin',
  BUILD_INACTIVE: 'Inactive',
  BUILD_NOT_PIN_MODE: 'Not in pin mode',
  BUILD_PUBLISH_RENAME_FAILED: 'Failed to publish bundle',
  BUILD_REQUIRED_FILE_MISSING: 'Required bundle file missing',
  // Source directory for published bundle missing
  BUNDLE_SRC_NOT_FOUND: 'Bundle source not found',
  NET_CONCURRENCY_LIMIT: 'Concurrency limit reached',
  NET_INVALID_SESSION: 'Invalid session',
  NET_OPEN_NEEDS_DOMAINS: 'Open network requires allowed domains',
  NET_DOMAIN_NOT_ALLOWED: 'Domain is not allowed',
} as const;

export type ErrorCode = keyof typeof ERROR_MESSAGES | `http_${number}`;

export class AppError extends Error {
  errorCode: ErrorCode;
  constructor(errorCode: ErrorCode, message?: string) {
    const defaultMessage = errorCode.startsWith('http_')
      ? `HTTP error ${errorCode.slice(5)}`
      : ERROR_MESSAGES[errorCode as keyof typeof ERROR_MESSAGES];
    super(message || defaultMessage);
    this.errorCode = errorCode;
  }
}

export function errorResponse(errorCode: ErrorCode, message?: string) {
  const defaultMessage = errorCode.startsWith('http_')
    ? `HTTP error ${errorCode.slice(5)}`
    : ERROR_MESSAGES[errorCode as keyof typeof ERROR_MESSAGES];
  return { errorCode, message: message || defaultMessage };
}

export class ForbiddenError extends Error {
  constructor(message = 'forbidden') {
    super(message);
    this.name = 'ForbiddenError';
  }
}
