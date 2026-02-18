import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  vi,
  beforeEach,
  afterEach,
} from 'vitest';
import { writeFile, mkdir, rm } from 'fs/promises';
import { join } from 'path';

// Mock axios before importing ApiValidator
vi.mock('axios', async importOriginal => {
  const actual = await importOriginal<typeof import('axios')>();
  return {
    ...actual,
    default: vi.fn(),
  };
});

import axios from 'axios';
import { AxiosError } from 'axios';
import { ApiValidator } from '../src/validators/api-validator.js';

const TEST_DIR = join(process.cwd(), 'test-fixtures-api');

const testSpec = {
  openapi: '3.0.3',
  info: {
    title: 'Test API',
    version: '1.0.0',
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
                    required: ['id', 'name'],
                  },
                },
              },
            },
          },
        },
      },
      post: {
        operationId: 'createUser',
        summary: 'Create a new user',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  email: { type: 'string', format: 'email' },
                },
                required: ['name'],
              },
              example: {
                name: 'Test User',
                email: 'test@example.com',
              },
            },
          },
        },
        responses: {
          '201': {
            description: 'User created',
            content: {
              'application/json': {
                schema: {
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
    '/users/{id}': {
      parameters: [
        {
          name: 'id',
          in: 'path',
          required: true,
          schema: { type: 'integer' },
          example: 123,
        },
      ],
      get: {
        operationId: 'getUserById',
        summary: 'Get user by ID',
        responses: {
          '200': {
            description: 'Successful response',
            headers: {
              'X-Rate-Limit': {
                schema: { type: 'integer' },
                description: 'Rate limit remaining',
              },
            },
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    id: { type: 'integer' },
                    name: { type: 'string' },
                  },
                },
              },
            },
          },
          '404': {
            description: 'User not found',
          },
        },
      },
    },
    '/users/{id}/posts': {
      get: {
        operationId: 'getUserPosts',
        summary: 'Get user posts',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            // No schema or example - should be skipped
          },
        ],
        responses: {
          '200': {
            description: 'Success',
          },
        },
      },
    },
  },
};

describe('ApiValidator', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await mkdir(TEST_DIR, { recursive: true });
    await writeFile(join(TEST_DIR, 'api-spec.json'), JSON.stringify(testSpec, null, 2));
  });

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  afterAll(() => {
    vi.resetAllMocks();
  });

  describe('validate', () => {
    it('should validate a successful API response', async () => {
      const mockAxios = vi.mocked(axios);
      mockAxios.mockResolvedValueOnce({
        status: 200,
        headers: {},
        data: [
          { id: 1, name: 'John' },
          { id: 2, name: 'Jane' },
        ],
      });

      const validator = new ApiValidator({
        baseUrl: 'http://localhost:3000',
        timeout: 5000,
      });

      const specPath = join(TEST_DIR, 'api-spec.json');
      const results = await validator.validate(testSpec, specPath, ['/users']);

      // Should have GET result
      const getResult = results.find(r => r.method === 'get');
      expect(getResult).toBeDefined();
      expect(getResult?.valid).toBe(true);
      expect(getResult?.path).toBe('/users');
      expect(getResult?.statusCode).toBe(200);
    });

    it('should fail validation when response does not match schema', async () => {
      const mockAxios = vi.mocked(axios);
      mockAxios.mockResolvedValueOnce({
        status: 200,
        headers: {},
        data: [
          { id: 'not-a-number', name: 'John' }, // id should be integer
        ],
      });

      const validator = new ApiValidator({
        baseUrl: 'http://localhost:3000',
        timeout: 5000,
      });

      const specPath = join(TEST_DIR, 'api-spec.json');
      const results = await validator.validate(testSpec, specPath, ['/users']);

      const getResult = results.find(r => r.method === 'get');
      expect(getResult?.valid).toBe(false);
      expect(getResult?.error).toBe('Response validation failed');
      expect(getResult?.details).toBeDefined();
    });

    it('should resolve path parameters with examples', async () => {
      const mockAxios = vi.mocked(axios);
      mockAxios.mockResolvedValueOnce({
        status: 200,
        headers: {},
        data: { id: 123, name: 'John' },
      });

      const validator = new ApiValidator({
        baseUrl: 'http://localhost:3000',
        timeout: 5000,
      });

      const specPath = join(TEST_DIR, 'api-spec.json');
      const results = await validator.validate(testSpec, specPath, ['/users/{id}']);

      // Should have called with resolved path
      expect(mockAxios).toHaveBeenCalledWith(
        expect.objectContaining({
          url: 'http://localhost:3000/users/123',
        })
      );

      const getResult = results.find(r => r.method === 'get');
      expect(getResult?.valid).toBe(true);
    });

    it('should skip endpoints without path parameter examples', async () => {
      const validator = new ApiValidator({
        baseUrl: 'http://localhost:3000',
        timeout: 5000,
      });

      const specPath = join(TEST_DIR, 'api-spec.json');
      const results = await validator.validate(testSpec, specPath, ['/users/{id}/posts']);

      const result = results.find(r => r.path === '/users/{id}/posts');
      expect(result).toBeDefined();
      expect(result?.error).toContain('Skipped');
    });

    it('should send request body for POST requests', async () => {
      const mockAxios = vi.mocked(axios);
      mockAxios.mockResolvedValueOnce({
        status: 200,
        headers: {},
        data: [],
      });
      mockAxios.mockResolvedValueOnce({
        status: 201,
        headers: {},
        data: { id: 1, name: 'Test User' },
      });

      const validator = new ApiValidator({
        baseUrl: 'http://localhost:3000',
        timeout: 5000,
      });

      const specPath = join(TEST_DIR, 'api-spec.json');
      await validator.validate(testSpec, specPath, ['/users']);

      // Check that POST was called with request body
      const postCall = mockAxios.mock.calls.find(call => call[0].method === 'post');
      expect(postCall).toBeDefined();
      expect(postCall?.[0].data).toEqual({
        name: 'Test User',
        email: 'test@example.com',
      });
      expect(postCall?.[0].headers['Content-Type']).toBe('application/json');
    });

    it('should handle connection errors', async () => {
      const mockAxios = vi.mocked(axios);
      const axiosError = new Error('Connection refused') as Error & { code: string };
      axiosError.code = 'ECONNREFUSED';
      mockAxios.mockRejectedValueOnce(axiosError);

      const validator = new ApiValidator({
        baseUrl: 'http://localhost:3000',
        timeout: 5000,
      });

      const specPath = join(TEST_DIR, 'api-spec.json');
      const results = await validator.validate(testSpec, specPath, ['/users']);

      const getResult = results.find(r => r.method === 'get');
      expect(getResult?.valid).toBe(false);
      expect(getResult?.error).toBeDefined();
    });

    it('should validate unexpected status codes', async () => {
      const mockAxios = vi.mocked(axios);
      mockAxios.mockResolvedValueOnce({
        status: 500, // Not defined in spec for /users GET
        headers: {},
        data: { error: 'Server error' },
      });

      const validator = new ApiValidator({
        baseUrl: 'http://localhost:3000',
        timeout: 5000,
      });

      const specPath = join(TEST_DIR, 'api-spec.json');
      const results = await validator.validate(testSpec, specPath, ['/users']);

      const getResult = results.find(r => r.method === 'get');
      expect(getResult?.valid).toBe(false);
      expect(getResult?.details).toContain('Unexpected status code 500 - not defined in spec');
    });
  });

  describe('constructor options', () => {
    it('should strip trailing slash from baseUrl', async () => {
      const mockAxios = vi.mocked(axios);
      mockAxios.mockResolvedValueOnce({
        status: 200,
        headers: {},
        data: [],
      });

      const validator = new ApiValidator({
        baseUrl: 'http://localhost:3000/',
        timeout: 5000,
      });

      const specPath = join(TEST_DIR, 'api-spec.json');
      await validator.validate(testSpec, specPath, ['/users']);

      expect(mockAxios).toHaveBeenCalledWith(
        expect.objectContaining({
          url: 'http://localhost:3000/users',
        })
      );
    });

    it('should include custom headers', async () => {
      const mockAxios = vi.mocked(axios);
      mockAxios.mockResolvedValueOnce({
        status: 200,
        headers: {},
        data: [],
      });

      const validator = new ApiValidator({
        baseUrl: 'http://localhost:3000',
        headers: {
          Authorization: 'Bearer token123',
          'X-Custom-Header': 'value',
        },
        timeout: 5000,
      });

      const specPath = join(TEST_DIR, 'api-spec.json');
      await validator.validate(testSpec, specPath, ['/users']);

      expect(mockAxios).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer token123',
            'X-Custom-Header': 'value',
          }),
        })
      );
    });
  });
});
