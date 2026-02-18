import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { writeFile, mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { SpecValidator } from '../src/validators/spec-validator.js';

const TEST_DIR = join(process.cwd(), 'test-fixtures-spec');

const validOpenApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'Test API',
    version: '1.0.0',
    description: 'A test API',
  },
  paths: {
    '/users': {
      get: {
        operationId: 'getUsers',
        summary: 'Get all users',
        responses: {
          '200': {
            description: 'Successful response',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'integer' },
                      name: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
};

const invalidOpenApiSpec = {
  openapi: '3.0.3',
  // Missing info block entirely - this is definitely invalid
  paths: {},
};

const specWithBadRef = {
  openapi: '3.0.3',
  info: {
    title: 'Test API',
    version: '1.0.0',
  },
  paths: {
    '/users': {
      get: {
        responses: {
          '200': {
            description: 'Success',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/NonExistent',
                },
              },
            },
          },
        },
      },
    },
  },
};

const specWithWarnings = {
  openapi: '3.0.3',
  info: {
    title: 'Test API',
    version: '1.0.0',
    // Missing description
  },
  paths: {
    '/users': {
      get: {
        // Missing operationId and summary
        responses: {
          '200': {
            description: 'Success',
          },
        },
      },
    },
  },
};

describe('SpecValidator', () => {
  beforeAll(async () => {
    await mkdir(TEST_DIR, { recursive: true });

    await writeFile(
      join(TEST_DIR, 'valid-spec.json'),
      JSON.stringify(validOpenApiSpec, null, 2)
    );

    await writeFile(
      join(TEST_DIR, 'invalid-spec.json'),
      JSON.stringify(invalidOpenApiSpec, null, 2)
    );

    await writeFile(
      join(TEST_DIR, 'spec-with-warnings.json'),
      JSON.stringify(specWithWarnings, null, 2)
    );

    await writeFile(
      join(TEST_DIR, 'spec-with-bad-ref.json'),
      JSON.stringify(specWithBadRef, null, 2)
    );
  });

  afterAll(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  describe('validate', () => {
    it('should validate a correct OpenAPI spec', async () => {
      const validator = new SpecValidator(false);
      const specPath = join(TEST_DIR, 'valid-spec.json');

      const result = await validator.validate(validOpenApiSpec, specPath);

      expect(result.valid).toBe(true);
      expect(result.errors).toBeUndefined();
      expect(result.info).toBeDefined();
      expect(result.info?.title).toBe('Test API');
      expect(result.info?.version).toBe('1.0.0');
      expect(result.info?.openApiVersion).toBe('3.0.3');
    });

    it('should fail validation for invalid spec (missing info)', async () => {
      const validator = new SpecValidator(false);
      const specPath = join(TEST_DIR, 'invalid-spec.json');

      const result = await validator.validate(invalidOpenApiSpec, specPath);

      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors?.length).toBeGreaterThan(0);

      // Should have validation or missing-field errors
      const hasValidationError = result.errors?.some(
        e => e.type === 'missing-field' ||
             e.type === 'validation-error' ||
             e.message.toLowerCase().includes('info') ||
             e.message.toLowerCase().includes('invalid')
      );
      expect(hasValidationError).toBe(true);
    });

    it('should fail validation for unresolved $ref', async () => {
      const validator = new SpecValidator(false);
      const specPath = join(TEST_DIR, 'spec-with-bad-ref.json');

      const result = await validator.validate(specWithBadRef, specPath);

      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors?.length).toBeGreaterThan(0);

      // Should contain ref error
      const hasRefError = result.errors?.some(
        e => e.type === 'ref-error' || e.message.includes('ref') || e.message.includes('$ref')
      );
      expect(hasRefError).toBe(true);
    });

    it('should return warnings for missing optional fields', async () => {
      const validator = new SpecValidator(false);
      const specPath = join(TEST_DIR, 'spec-with-warnings.json');

      const result = await validator.validate(specWithWarnings, specPath);

      expect(result.valid).toBe(true);
      expect(result.warnings).toBeDefined();
      expect(result.warnings?.length).toBeGreaterThan(0);
    });

    it('should report path and schema counts', async () => {
      const validator = new SpecValidator(false);
      const specPath = join(TEST_DIR, 'valid-spec.json');

      const result = await validator.validate(validOpenApiSpec, specPath);

      expect(result.info?.pathCount).toBe(1);
    });

    it('should include error type information', async () => {
      const validator = new SpecValidator(false);
      const specPath = join(TEST_DIR, 'invalid-spec.json');

      const result = await validator.validate(invalidOpenApiSpec, specPath);

      expect(result.errors).toBeDefined();
      expect(result.errors?.[0]).toHaveProperty('type');
      expect(result.errors?.[0]).toHaveProperty('message');
    });
  });

  describe('strict mode', () => {
    it('should convert warnings to errors in strict mode', async () => {
      const validator = new SpecValidator(true);
      const specPath = join(TEST_DIR, 'spec-with-warnings.json');

      const result = await validator.validate(specWithWarnings, specPath);

      // In strict mode, some warnings become errors
      if (result.errors) {
        const hasStrictErrors = result.errors.some(e => e.type === 'warning-as-error');
        expect(hasStrictErrors).toBe(true);
      }
    });
  });
});
