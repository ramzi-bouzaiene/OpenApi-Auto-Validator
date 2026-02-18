export type ValidationErrorType =
  | 'syntax-error'
  | 'missing-field'
  | 'invalid-type'
  | 'ref-error'
  | 'validation-error'
  | 'warning-as-error'
  | 'unknown';

export interface ValidationError {
  type: ValidationErrorType;
  message: string;
  path?: string;
  details?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors?: ValidationError[];
  warnings?: string[];
  info?: SpecInfo;
}

export interface SpecInfo {
  title: string;
  version: string;
  openApiVersion?: string;
  pathCount?: number;
  schemaCount?: number;
}

export interface ApiValidationResult {
  path: string;
  method: string;
  valid: boolean;
  statusCode?: number;
  responseTime: number;
  error?: string;
  details?: string[];
}

export interface ApiValidatorOptions {
  baseUrl: string;
  headers?: Record<string, string>;
  timeout?: number;
}

export const ExitCodes = {
  SUCCESS: 0,
  VALIDATION_FAILED: 1,
  FILE_NOT_FOUND: 2,
  INVALID_COMMAND: 3,
} as const;

export type ExitCode = typeof ExitCodes[keyof typeof ExitCodes];
