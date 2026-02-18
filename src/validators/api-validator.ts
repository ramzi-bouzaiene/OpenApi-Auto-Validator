import SwaggerParser from '@apidevtools/swagger-parser';
import axios, { AxiosError, type AxiosRequestConfig, type AxiosResponse } from 'axios';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import type { OpenAPI, OpenAPIV3 } from 'openapi-types';
import type { ApiValidationResult, ApiValidatorOptions } from '../utils/types.js';

interface AjvError {
  instancePath: string;
  message?: string;
}

interface HeaderValidationError {
  header: string;
  message: string;
}

// Get the actual Ajv class (handles both ESM and CJS)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const AjvClass = (Ajv as any).default || Ajv;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const addFormatsFunc = (addFormats as any).default || addFormats;

export class ApiValidator {
  private baseUrl: string;
  private headers: Record<string, string>;
  private timeout: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private ajv: any;

  constructor(options: ApiValidatorOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, ''); // Remove trailing slash
    this.headers = options.headers || {};
    this.timeout = options.timeout || 5000;

    this.ajv = new AjvClass({
      allErrors: true,
      strict: false,
      validateFormats: true,
    });
    addFormatsFunc(this.ajv);
  }

  async validate(
    spec: unknown,
    specPath: string,
    endpoints?: string[]
  ): Promise<ApiValidationResult[]> {
    const results: ApiValidationResult[] = [];

    try {
      // Parse and dereference the spec
      const api = (await SwaggerParser.dereference(specPath)) as OpenAPIV3.Document;

      if (!api.paths) {
        return [
          {
            path: '/',
            method: 'get',
            valid: false,
            error: 'No paths defined in specification',
            responseTime: 0,
          },
        ];
      }

      // Get list of endpoints to test
      const pathsToTest = endpoints
        ? Object.entries(api.paths).filter(([path]) => endpoints.includes(path))
        : Object.entries(api.paths);

      for (const [path, pathItem] of pathsToTest) {
        if (!pathItem) continue;

        const methods = ['get', 'post', 'put', 'patch', 'delete'] as const;

        for (const method of methods) {
          const operation = (pathItem as Record<string, unknown>)[
            method
          ] as OpenAPIV3.OperationObject | undefined;

          if (operation) {
            const result = await this.testEndpoint(path, method, operation, api, pathItem);
            results.push(result);
          }
        }
      }

      return results;
    } catch (error) {
      if (error instanceof Error) {
        return [
          {
            path: '/',
            method: 'get',
            valid: false,
            error: error.message,
            responseTime: 0,
          },
        ];
      }
      throw error;
    }
  }

  /**
   * Resolve path with parameter values from examples or generated defaults
   */
  private resolvePath(
    path: string,
    operation: OpenAPIV3.OperationObject,
    pathItem: OpenAPIV3.PathItemObject
  ): { resolvedPath: string; skipped: boolean; skipReason?: string } {
    const pathParamMatches = path.match(/\{([^}]+)\}/g);
    if (!pathParamMatches) {
      return { resolvedPath: path, skipped: false };
    }

    let resolvedPath = path;
    const allParameters = [...(pathItem.parameters || []), ...(operation.parameters || [])];

    for (const match of pathParamMatches) {
      const paramName = match.slice(1, -1);
      const param = allParameters.find(
        p => 'name' in p && p.name === paramName && (p as OpenAPIV3.ParameterObject).in === 'path'
      ) as OpenAPIV3.ParameterObject | undefined;

      if (!param) {
        return {
          resolvedPath: path,
          skipped: true,
          skipReason: `Missing path parameter definition: ${paramName}`,
        };
      }

      // Get example value from various sources
      const exampleValue = this.getParameterExample(param);
      if (exampleValue === undefined) {
        return {
          resolvedPath: path,
          skipped: true,
          skipReason: `No example value for path parameter: ${paramName}`,
        };
      }

      resolvedPath = resolvedPath.replace(match, String(exampleValue));
    }

    return { resolvedPath, skipped: false };
  }

  /**
   * Extract example value from parameter definition
   */
  private getParameterExample(param: OpenAPIV3.ParameterObject): unknown {
    // Direct example
    if (param.example !== undefined) {
      return param.example;
    }

    // Examples object (use first one)
    if (param.examples) {
      const firstExample = Object.values(param.examples)[0];
      if (firstExample && 'value' in firstExample) {
        return (firstExample as OpenAPIV3.ExampleObject).value;
      }
    }

    // Schema example or default
    if (param.schema) {
      const schema = param.schema as OpenAPIV3.SchemaObject;
      if (schema.example !== undefined) return schema.example;
      if (schema.default !== undefined) return schema.default;

      // Generate value based on type
      return this.generateExampleFromSchema(schema);
    }

    return undefined;
  }

  /**
   * Generate example value from schema definition
   */
  private generateExampleFromSchema(schema: OpenAPIV3.SchemaObject): unknown {
    if (schema.example !== undefined) return schema.example;
    if (schema.default !== undefined) return schema.default;

    // Handle enum - use first value
    if (schema.enum && schema.enum.length > 0) {
      return schema.enum[0];
    }

    switch (schema.type) {
      case 'string':
        if (schema.format === 'date') return '2024-01-01';
        if (schema.format === 'date-time') return '2024-01-01T00:00:00Z';
        if (schema.format === 'email') return 'test@example.com';
        if (schema.format === 'uuid') return '550e8400-e29b-41d4-a716-446655440000';
        if (schema.format === 'uri') return 'https://example.com';
        if (schema.minLength) return 'x'.repeat(schema.minLength);
        return 'string';
      case 'integer':
        return schema.minimum ?? 1;
      case 'number':
        return schema.minimum ?? 1.0;
      case 'boolean':
        return true;
      case 'array':
        if (schema.items) {
          const itemExample = this.generateExampleFromSchema(
            schema.items as OpenAPIV3.SchemaObject
          );
          return [itemExample];
        }
        return [];
      case 'object':
        return this.generateObjectExample(schema);
      default:
        return null;
    }
  }

  /**
   * Generate example object from schema properties
   */
  private generateObjectExample(schema: OpenAPIV3.SchemaObject): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    if (schema.properties) {
      const requiredFields = schema.required || [];

      for (const [propName, propSchema] of Object.entries(schema.properties)) {
        // Include required fields and fields with examples
        const prop = propSchema as OpenAPIV3.SchemaObject;
        if (requiredFields.includes(propName) || prop.example !== undefined) {
          result[propName] = this.generateExampleFromSchema(prop);
        }
      }
    }

    return result;
  }

  /**
   * Build request body from operation's requestBody definition
   */
  private buildRequestBody(
    operation: OpenAPIV3.OperationObject
  ): { body: unknown; contentType: string } | null {
    if (!operation.requestBody) {
      return null;
    }

    const requestBody = operation.requestBody as OpenAPIV3.RequestBodyObject;
    const content = requestBody.content;

    if (!content) {
      return null;
    }

    // Prefer JSON content type
    const jsonContent = content['application/json'];
    if (jsonContent) {
      const body = this.extractBodyExample(jsonContent);
      return { body, contentType: 'application/json' };
    }

    // Try form data
    const formContent = content['application/x-www-form-urlencoded'];
    if (formContent) {
      const body = this.extractBodyExample(formContent);
      return { body, contentType: 'application/x-www-form-urlencoded' };
    }

    return null;
  }

  /**
   * Extract body example from media type object
   */
  private extractBodyExample(mediaType: OpenAPIV3.MediaTypeObject): unknown {
    // Direct example
    if (mediaType.example !== undefined) {
      return mediaType.example;
    }

    // Examples object
    if (mediaType.examples) {
      const firstExample = Object.values(mediaType.examples)[0];
      if (firstExample && 'value' in firstExample) {
        return (firstExample as OpenAPIV3.ExampleObject).value;
      }
    }

    // Generate from schema
    if (mediaType.schema) {
      return this.generateExampleFromSchema(mediaType.schema as OpenAPIV3.SchemaObject);
    }

    return {};
  }

  /**
   * Build query parameters from operation definition
   */
  private buildQueryParams(
    operation: OpenAPIV3.OperationObject,
    pathItem: OpenAPIV3.PathItemObject
  ): Record<string, string> {
    const params: Record<string, string> = {};
    const allParameters = [...(pathItem.parameters || []), ...(operation.parameters || [])];

    for (const p of allParameters) {
      const param = p as OpenAPIV3.ParameterObject;
      if (param.in === 'query') {
        // Only include required params or those with examples
        if (param.required || param.example !== undefined) {
          const value = this.getParameterExample(param);
          if (value !== undefined) {
            params[param.name] = String(value);
          }
        }
      }
    }

    return params;
  }

  private async testEndpoint(
    path: string,
    method: string,
    operation: OpenAPIV3.OperationObject,
    api: OpenAPIV3.Document,
    pathItem: OpenAPIV3.PathItemObject
  ): Promise<ApiValidationResult> {
    const startTime = Date.now();

    // Resolve path parameters
    const { resolvedPath, skipped, skipReason } = this.resolvePath(path, operation, pathItem);

    if (skipped) {
      return {
        path,
        method,
        valid: true,
        statusCode: 0,
        responseTime: 0,
        error: `Skipped - ${skipReason}`,
      };
    }

    const url = `${this.baseUrl}${resolvedPath}`;

    // Build query parameters
    const queryParams = this.buildQueryParams(operation, pathItem);

    // Build request body for POST/PUT/PATCH
    const requestBodyData = this.buildRequestBody(operation);

    const config: AxiosRequestConfig = {
      method: method as AxiosRequestConfig['method'],
      url,
      headers: {
        ...this.headers,
        Accept: 'application/json',
      },
      params: Object.keys(queryParams).length > 0 ? queryParams : undefined,
      timeout: this.timeout,
      validateStatus: () => true, // Accept any status code
    };

    // Add request body if present
    if (requestBodyData && ['post', 'put', 'patch'].includes(method)) {
      config.data = requestBodyData.body;
      config.headers = {
        ...config.headers,
        'Content-Type': requestBodyData.contentType,
      };
    }

    try {
      const response = await axios(config);
      const responseTime = Date.now() - startTime;

      // Validate response (status, headers, body)
      const validationResult = this.validateFullResponse(response, operation);

      return {
        path,
        method,
        valid: validationResult.valid,
        statusCode: response.status,
        responseTime,
        error: validationResult.error,
        details: validationResult.details,
      };
    } catch (error) {
      const responseTime = Date.now() - startTime;

      if (error instanceof AxiosError) {
        return {
          path,
          method,
          valid: false,
          responseTime,
          error:
            error.code === 'ECONNREFUSED'
              ? 'Connection refused - is the server running?'
              : error.message,
        };
      }

      return {
        path,
        method,
        valid: false,
        responseTime,
        error: 'Unknown error occurred',
      };
    }
  }

  /**
   * Validate the full response including status code, headers, and body
   */
  private validateFullResponse(
    response: AxiosResponse,
    operation: OpenAPIV3.OperationObject
  ): { valid: boolean; error?: string; details?: string[] } {
    const details: string[] = [];
    let hasErrors = false;

    if (!operation.responses) {
      return { valid: true }; // No response schema defined, consider valid
    }

    // 1. Validate status code
    const statusValidation = this.validateStatusCode(response.status, operation);
    if (!statusValidation.valid) {
      hasErrors = true;
      if (statusValidation.error) details.push(statusValidation.error);
    }

    // Get the response spec for further validation
    const responseSpec = this.getResponseSpec(response.status, operation);
    if (!responseSpec) {
      return {
        valid: !hasErrors,
        error: hasErrors ? 'Response validation failed' : undefined,
        details: details.length > 0 ? details : undefined,
      };
    }

    // 2. Validate response headers
    const headerValidation = this.validateResponseHeaders(response.headers, responseSpec);
    if (!headerValidation.valid) {
      hasErrors = true;
      details.push(...headerValidation.errors.map(e => `Header '${e.header}': ${e.message}`));
    }

    // 3. Validate response body
    const bodyValidation = this.validateResponseBody(response.data, responseSpec);
    if (!bodyValidation.valid) {
      hasErrors = true;
      if (bodyValidation.details) details.push(...bodyValidation.details);
    }

    return {
      valid: !hasErrors,
      error: hasErrors ? 'Response validation failed' : undefined,
      details: details.length > 0 ? details : undefined,
    };
  }

  /**
   * Validate that the status code is defined in the spec
   */
  private validateStatusCode(
    statusCode: number,
    operation: OpenAPIV3.OperationObject
  ): { valid: boolean; error?: string } {
    if (!operation.responses) {
      return { valid: true };
    }

    const statusStr = statusCode.toString();
    const hasExactMatch = statusStr in operation.responses;
    const hasWildcardMatch = `${statusStr[0]}XX` in operation.responses;
    const hasDefaultMatch = 'default' in operation.responses;

    if (!hasExactMatch && !hasWildcardMatch && !hasDefaultMatch) {
      return {
        valid: false,
        error: `Unexpected status code ${statusCode} - not defined in spec`,
      };
    }

    return { valid: true };
  }

  /**
   * Get the response specification for a given status code
   */
  private getResponseSpec(
    statusCode: number,
    operation: OpenAPIV3.OperationObject
  ): OpenAPIV3.ResponseObject | null {
    if (!operation.responses) return null;

    const statusStr = statusCode.toString();
    const responseSpec =
      operation.responses[statusStr] ||
      operation.responses[`${statusStr[0]}XX`] ||
      operation.responses['default'];

    return (responseSpec as OpenAPIV3.ResponseObject) || null;
  }

  /**
   * Validate response headers against spec
   */
  private validateResponseHeaders(
    headers: Record<string, unknown>,
    responseSpec: OpenAPIV3.ResponseObject
  ): { valid: boolean; errors: HeaderValidationError[] } {
    const errors: HeaderValidationError[] = [];

    if (!responseSpec.headers) {
      return { valid: true, errors: [] };
    }

    for (const [headerName, headerSpec] of Object.entries(responseSpec.headers)) {
      const spec = headerSpec as OpenAPIV3.HeaderObject;
      const headerValue = headers[headerName.toLowerCase()];

      // Check if required header is present
      if (spec.required && headerValue === undefined) {
        errors.push({
          header: headerName,
          message: 'Required header is missing',
        });
        continue;
      }

      // Validate header value against schema if present
      if (headerValue !== undefined && spec.schema) {
        const schema = spec.schema as OpenAPIV3.SchemaObject;
        const validate = this.ajv.compile(schema);
        const isValid = validate(headerValue);

        if (!isValid && validate.errors) {
          errors.push({
            header: headerName,
            message: validate.errors.map((e: AjvError) => e.message).join(', '),
          });
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Validate response body against schema
   */
  private validateResponseBody(
    responseData: unknown,
    responseSpec: OpenAPIV3.ResponseObject
  ): { valid: boolean; details?: string[] } {
    const content = responseSpec.content;

    if (!content) {
      return { valid: true }; // No content schema defined
    }

    // Check JSON content type
    const jsonContent = content['application/json'];
    if (!jsonContent?.schema) {
      return { valid: true }; // No JSON schema defined
    }

    // Validate response body against schema
    const schema = jsonContent.schema;
    const validate = this.ajv.compile(schema);
    const isValid = validate(responseData);

    if (!isValid && validate.errors) {
      const details = validate.errors.map((err: AjvError) => {
        const path = err.instancePath || 'root';
        return `Body ${path}: ${err.message}`;
      });

      return {
        valid: false,
        details,
      };
    }

    return { valid: true };
  }
}
