import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { writeFile, mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { loadSpec, isYamlFile, isJsonFile } from '../src/utils/loader.js';

const TEST_DIR = join(process.cwd(), 'test-fixtures');

const sampleSpec = {
  openapi: '3.0.3',
  info: {
    title: 'Test API',
    version: '1.0.0',
  },
  paths: {},
};

const yamlContent = `openapi: '3.0.3'
info:
  title: Test API
  version: '1.0.0'
paths: {}
`;

describe('Loader', () => {
  beforeAll(async () => {
    await mkdir(TEST_DIR, { recursive: true });

    await writeFile(
      join(TEST_DIR, 'spec.json'),
      JSON.stringify(sampleSpec, null, 2)
    );

    await writeFile(
      join(TEST_DIR, 'spec.yaml'),
      yamlContent
    );

    await writeFile(
      join(TEST_DIR, 'spec.yml'),
      yamlContent
    );
  });

  afterAll(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  describe('loadSpec', () => {
    it('should load a JSON spec file', async () => {
      const spec = await loadSpec(join(TEST_DIR, 'spec.json'));

      expect(spec).toEqual(sampleSpec);
    });

    it('should load a YAML spec file', async () => {
      const spec = await loadSpec(join(TEST_DIR, 'spec.yaml'));

      expect(spec).toMatchObject({
        openapi: '3.0.3',
        info: {
          title: 'Test API',
          version: '1.0.0',
        },
      });
    });

    it('should load a .yml spec file', async () => {
      const spec = await loadSpec(join(TEST_DIR, 'spec.yml'));

      expect(spec).toMatchObject({
        openapi: '3.0.3',
        info: {
          title: 'Test API',
        },
      });
    });

    it('should throw error for non-existent file', async () => {
      await expect(
        loadSpec(join(TEST_DIR, 'non-existent.json'))
      ).rejects.toThrow('File not found');
    });
  });

  describe('isYamlFile', () => {
    it('should return true for .yaml files', () => {
      expect(isYamlFile('spec.yaml')).toBe(true);
    });

    it('should return true for .yml files', () => {
      expect(isYamlFile('spec.yml')).toBe(true);
    });

    it('should return false for .json files', () => {
      expect(isYamlFile('spec.json')).toBe(false);
    });

    it('should be case insensitive', () => {
      expect(isYamlFile('spec.YAML')).toBe(true);
      expect(isYamlFile('spec.YML')).toBe(true);
    });
  });

  describe('isJsonFile', () => {
    it('should return true for .json files', () => {
      expect(isJsonFile('spec.json')).toBe(true);
    });

    it('should return false for .yaml files', () => {
      expect(isJsonFile('spec.yaml')).toBe(false);
    });

    it('should be case insensitive', () => {
      expect(isJsonFile('spec.JSON')).toBe(true);
    });
  });
});
