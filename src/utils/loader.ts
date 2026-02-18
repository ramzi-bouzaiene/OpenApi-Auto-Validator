import { readFile } from 'fs/promises';
import { extname } from 'path';
import yaml from 'js-yaml';

export async function loadSpec(specPath: string): Promise<unknown> {
  const ext = extname(specPath).toLowerCase();

  try {
    const content = await readFile(specPath, 'utf-8');

    if (ext === '.yaml' || ext === '.yml') {
      return yaml.load(content);
    } else if (ext === '.json') {
      return JSON.parse(content);
    } else {
      // Try to parse as YAML first (YAML is a superset of JSON)
      try {
        return yaml.load(content);
      } catch {
        return JSON.parse(content);
      }
    }
  } catch (error) {
    if (error instanceof Error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(`File not found: ${specPath}`);
      }
      throw new Error(`Failed to load spec file: ${error.message}`);
    }
    throw error;
  }
}

export function isYamlFile(specPath: string): boolean {
  const ext = extname(specPath).toLowerCase();
  return ext === '.yaml' || ext === '.yml';
}

export function isJsonFile(specPath: string): boolean {
  const ext = extname(specPath).toLowerCase();
  return ext === '.json';
}
