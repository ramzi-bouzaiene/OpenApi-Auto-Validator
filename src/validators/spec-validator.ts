import SwaggerParser from '@apidevtools/swagger-parser';
import type { OpenAPI, OpenAPIV3, OpenAPIV3_1 } from 'openapi-types';
import type { ValidationResult, SpecInfo, ValidationError } from '../utils/types.js';

export class SpecValidator {
  private strict: boolean;

  constructor(strict: boolean = false) {
    this.strict = strict;
  }

  async validate(spec: unknown, specPath: string): Promise<ValidationResult> {
    const errors: ValidationError[] = [];
    const warnings: string[] = [];

    try {
      // Step 1: Parse and resolve $ref pointers
      let api: OpenAPI.Document;
      try {
        api = await SwaggerParser.dereference(specPath);
      } catch (refError) {
        const error = this.parseRefError(refError);
        errors.push(error);
        return {
          valid: false,
          errors,
          warnings: warnings.length > 0 ? warnings : undefined,
        };
      }

      // Step 2: Validate against OpenAPI schema
      try {
        await SwaggerParser.validate(specPath, {
          validate: {
            spec: true,
            schema: true,
          },
        });
      } catch (validationError) {
        const parsedErrors = this.parseValidationError(validationError);
        errors.push(...parsedErrors);
      }

      // Step 3: Check for missing required fields
      const requiredFieldErrors = this.checkRequiredFields(api);
      errors.push(...requiredFieldErrors);

      // Step 4: Extract spec information
      const info = this.extractSpecInfo(api);

      // Step 5: Perform additional validation checks
      const additionalChecks = this.performAdditionalChecks(api);
      warnings.push(...additionalChecks.warnings);

      if (this.strict) {
        errors.push(...additionalChecks.errors.map(msg => ({
          type: 'warning-as-error' as const,
          message: msg,
        })));
      }

      return {
        valid: errors.length === 0,
        errors: errors.length > 0 ? errors : undefined,
        warnings: warnings.length > 0 ? warnings : undefined,
        info,
      };
    } catch (error) {
      const parsedError = this.parseGenericError(error);
      errors.push(parsedError);

      return {
        valid: false,
        errors,
        warnings: warnings.length > 0 ? warnings : undefined,
      };
    }
  }

  private parseRefError(error: unknown): ValidationError {
    if (error instanceof Error) {
      const message = error.message;

      // Check for unresolved $ref
      if (message.includes('$ref')) {
        const refMatch = message.match(/"\$ref":\s*"([^"]+)"/);
        const pointer = refMatch ? refMatch[1] : 'unknown';
        return {
          type: 'ref-error',
          message: `Failed to resolve $ref pointer: ${pointer}`,
          path: pointer,
          details: message,
        };
      }

      // Check for missing info or other validation issues
      if (message.includes('not a valid') || message.includes('invalid')) {
        return {
          type: 'validation-error',
          message: 'Invalid OpenAPI specification',
          details: message,
        };
      }

      return {
        type: 'ref-error',
        message: 'Failed to resolve references in specification',
        details: message,
      };
    }

    return {
      type: 'ref-error',
      message: 'Unknown reference resolution error',
    };
  }

  private parseValidationError(error: unknown): ValidationError[] {
    const errors: ValidationError[] = [];

    if (error instanceof Error) {
      const message = error.message;

      // Parse multiple errors from the message
      const lines = message.split('\n').filter(line => line.trim());

      for (const line of lines) {
        // Check for missing required field
        if (line.includes('required') || line.includes('must have')) {
          const fieldMatch = line.match(/["']([^"']+)["']/);
          errors.push({
            type: 'missing-field',
            message: line.trim(),
            path: fieldMatch ? fieldMatch[1] : undefined,
          });
        }
        // Check for invalid type
        else if (line.includes('type') || line.includes('should be')) {
          errors.push({
            type: 'invalid-type',
            message: line.trim(),
          });
        }
        // Check for invalid syntax
        else if (line.includes('syntax') || line.includes('parse') || line.includes('unexpected')) {
          errors.push({
            type: 'syntax-error',
            message: line.trim(),
          });
        }
        // Generic validation error
        else if (line.trim()) {
          errors.push({
            type: 'validation-error',
            message: line.trim(),
          });
        }
      }

      // If no specific errors parsed, add the full message
      if (errors.length === 0) {
        errors.push({
          type: 'validation-error',
          message: message,
        });
      }
    } else {
      errors.push({
        type: 'validation-error',
        message: 'Unknown validation error',
      });
    }

    return errors;
  }

  private parseGenericError(error: unknown): ValidationError {
    if (error instanceof Error) {
      // Check for YAML/JSON syntax errors
      if (error.message.includes('YAML') || error.message.includes('JSON')) {
        return {
          type: 'syntax-error',
          message: 'Invalid file syntax',
          details: error.message,
        };
      }

      return {
        type: 'unknown',
        message: error.message,
      };
    }

    return {
      type: 'unknown',
      message: 'An unexpected error occurred',
    };
  }

  private checkRequiredFields(api: OpenAPI.Document): ValidationError[] {
    const errors: ValidationError[] = [];

    // Check top-level required fields
    if (!api.info) {
      errors.push({
        type: 'missing-field',
        message: 'Missing required field: info',
        path: 'info',
      });
    } else {
      if (!api.info.title) {
        errors.push({
          type: 'missing-field',
          message: 'Missing required field: info.title',
          path: 'info.title',
        });
      }
      if (!api.info.version) {
        errors.push({
          type: 'missing-field',
          message: 'Missing required field: info.version',
          path: 'info.version',
        });
      }
    }

    // Check OpenAPI version field
    const hasOpenApiVersion = 'openapi' in api || 'swagger' in api;
    if (!hasOpenApiVersion) {
      errors.push({
        type: 'missing-field',
        message: 'Missing required field: openapi (or swagger for v2)',
        path: 'openapi',
      });
    }

    // Check paths for required fields
    if (api.paths) {
      for (const [path, pathItem] of Object.entries(api.paths)) {
        if (!pathItem) continue;

        const methods = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head'] as const;

        for (const method of methods) {
          const operation = (pathItem as Record<string, unknown>)[method] as OpenAPIV3.OperationObject | undefined;

          if (operation) {
            // Check for required responses field
            if (!operation.responses) {
              errors.push({
                type: 'missing-field',
                message: `Missing required field: responses for ${method.toUpperCase()} ${path}`,
                path: `paths.${path}.${method}.responses`,
              });
            }

            // Check parameters for required fields
            if (operation.parameters) {
              operation.parameters.forEach((param, index) => {
                const p = param as OpenAPIV3.ParameterObject;
                if (!p.name) {
                  errors.push({
                    type: 'missing-field',
                    message: `Missing required field: name for parameter ${index} in ${method.toUpperCase()} ${path}`,
                    path: `paths.${path}.${method}.parameters[${index}].name`,
                  });
                }
                if (!p.in) {
                  errors.push({
                    type: 'missing-field',
                    message: `Missing required field: in for parameter ${index} in ${method.toUpperCase()} ${path}`,
                    path: `paths.${path}.${method}.parameters[${index}].in`,
                  });
                }
              });
            }
          }
        }
      }
    }

    return errors;
  }

  private extractSpecInfo(api: OpenAPI.Document): SpecInfo {
    const info: SpecInfo = {
      title: api.info.title,
      version: api.info.version,
    };

    // Determine OpenAPI version
    if ('openapi' in api) {
      info.openApiVersion = (api as OpenAPIV3.Document | OpenAPIV3_1.Document).openapi;
    } else if ('swagger' in api) {
      info.openApiVersion = `Swagger ${(api as { swagger: string }).swagger}`;
    }

    // Count paths
    if (api.paths) {
      info.pathCount = Object.keys(api.paths).length;
    }

    // Count schemas
    if ('components' in api && (api as OpenAPIV3.Document).components?.schemas) {
      info.schemaCount = Object.keys((api as OpenAPIV3.Document).components!.schemas!).length;
    } else if ('definitions' in api) {
      const swaggerApi = api as { definitions?: Record<string, unknown> };
      if (swaggerApi.definitions) {
        info.schemaCount = Object.keys(swaggerApi.definitions).length;
      }
    }

    return info;
  }

  private performAdditionalChecks(api: OpenAPI.Document): { errors: string[]; warnings: string[] } {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check for empty paths
    if (!api.paths || Object.keys(api.paths).length === 0) {
      warnings.push('No paths defined in the specification');
    }

    // Check for missing descriptions
    if (!api.info.description) {
      warnings.push('Missing API description');
    }

    // Check paths for missing operation IDs and descriptions
    if (api.paths) {
      for (const [path, pathItem] of Object.entries(api.paths)) {
        if (!pathItem) continue;

        const methods = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head'] as const;

        for (const method of methods) {
          const operation = (pathItem as Record<string, unknown>)[method] as OpenAPIV3.OperationObject | undefined;

          if (operation) {
            if (!operation.operationId) {
              warnings.push(`Missing operationId for ${method.toUpperCase()} ${path}`);
            }

            if (!operation.summary && !operation.description) {
              warnings.push(`Missing summary/description for ${method.toUpperCase()} ${path}`);
            }

            // Check for response definitions
            if (!operation.responses || Object.keys(operation.responses).length === 0) {
              errors.push(`No responses defined for ${method.toUpperCase()} ${path}`);
            }
          }
        }
      }
    }

    // Check for security definitions
    if ('components' in api) {
      const openApi3 = api as OpenAPIV3.Document;
      if (openApi3.security && openApi3.security.length > 0) {
        if (!openApi3.components?.securitySchemes) {
          errors.push('Security requirements defined but no security schemes found');
        }
      }
    }

    return { errors, warnings };
  }
}
