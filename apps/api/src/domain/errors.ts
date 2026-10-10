export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance?: string;
  code: string;
  timestamp: string;
  [key: string]: unknown;
}

export class AppError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly title: string;
  public readonly detail: string;
  public readonly typeUrl: string;

  constructor(status: number, code: string, title: string, detail: string, typeUrl?: string) {
    super(detail);
    this.name = this.constructor.name;
    this.status = status;
    this.code = code;
    this.title = title;
    this.detail = detail;
    this.typeUrl = typeUrl ?? `https://api.platform.local/errors/${code.toLowerCase().replace(/_/g, '-')}`;
  }

  toProblemDetails(instance?: string): ProblemDetails {
    return {
      type: this.typeUrl,
      title: this.title,
      status: this.status,
      detail: this.detail,
      instance,
      code: this.code,
      timestamp: new Date().toISOString(),
    };
  }
}

export class NotFoundError extends AppError {
  constructor(detail: string, code = 'NOT_FOUND') {
    super(404, code, 'Resource Not Found', detail);
  }
}

export class ConflictError extends AppError {
  constructor(detail: string, code = 'CONFLICT') {
    super(409, code, 'Conflict', detail);
  }
}

export class ValidationError extends AppError {
  public readonly validationErrors?: unknown;

  constructor(detail: string, validationErrors?: unknown, code = 'VALIDATION_FAILED') {
    super(400, code, 'Invalid Request', detail);
    this.validationErrors = validationErrors;
  }

  override toProblemDetails(instance?: string): ProblemDetails {
    const base = super.toProblemDetails(instance);
    if (this.validationErrors) {
      base['errors'] = this.validationErrors;
    }
    return base;
  }
}

export class UnauthorizedError extends AppError {
  constructor(detail = 'Missing or invalid authentication credentials', code = 'UNAUTHORIZED') {
    super(401, code, 'Unauthorized', detail);
  }
}

export class ForbiddenError extends AppError {
  constructor(detail = 'You do not have permission to access this resource', code = 'FORBIDDEN') {
    super(403, code, 'Forbidden', detail);
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(detail = 'Underlying dependency is unavailable', code = 'SERVICE_UNAVAILABLE') {
    super(503, code, 'Service Unavailable', detail);
  }
}

