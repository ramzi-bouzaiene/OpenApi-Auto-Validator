import { ApiValidator } from '../../validators/api-validator.js';
import { loadSpec } from '../../utils/loader.js';
import { logger } from '../../utils/logger.js';
import { ExitCodes } from '../../utils/types.js';

interface ValidateApiOptions {
  url: string;
  endpoints?: string;
  header?: string[];
  timeout: string;
}

function parseHeaders(headerArgs?: string[]): Record<string, string> {
  const headers: Record<string, string> = {};

  if (!headerArgs) return headers;

  for (const header of headerArgs) {
    const colonIndex = header.indexOf(':');
    if (colonIndex > 0) {
      const key = header.substring(0, colonIndex).trim();
      const value = header.substring(colonIndex + 1).trim();
      headers[key] = value;
    }
  }

  return headers;
}

export async function validateApiCommand(
  specPath: string,
  options: ValidateApiOptions
): Promise<void> {
  const { url, endpoints, header, timeout } = options;

  logger.info(`Validating API at ${url} against spec: ${specPath}\n`);

  try {
    // Load the spec file
    const rawSpec = await loadSpec(specPath);

    // Parse options
    const endpointList = endpoints
      ? endpoints.split(',').map(e => e.trim())
      : undefined;
    const headers = parseHeaders(header);
    const timeoutMs = parseInt(timeout, 10);

    // Create validator and validate
    const validator = new ApiValidator({
      baseUrl: url,
      headers,
      timeout: timeoutMs,
    });

    const results = await validator.validate(rawSpec, specPath, endpointList);

    // Display results
    let passedCount = 0;
    let failedCount = 0;
    let skippedCount = 0;

    console.log(''); // Empty line for spacing

    for (const result of results) {
      // Check if this was a skipped endpoint
      const isSkipped = result.error?.startsWith('Skipped');

      if (isSkipped) {
        skippedCount++;
        logger.dim(
          `○ ${result.method.toUpperCase()} ${result.path} - ${result.error}`
        );
      } else if (result.valid) {
        passedCount++;
        logger.success(
          `✓ ${result.method.toUpperCase()} ${result.path} - ${result.statusCode} OK (${result.responseTime}ms)`
        );
      } else {
        failedCount++;
        const statusInfo = result.statusCode ? ` [${result.statusCode}]` : '';
        logger.error(
          `✗ ${result.method.toUpperCase()} ${result.path}${statusInfo} - ${result.error || 'Validation failed'}`
        );
        if (result.details && result.details.length > 0) {
          result.details.forEach(detail => {
            logger.errorDetail(`  └─ ${detail}`);
          });
        }
      }
    }

    console.log(''); // Empty line for spacing

    // Summary
    const summaryParts = [`${passedCount} passed`, `${failedCount} failed`];
    if (skippedCount > 0) {
      summaryParts.push(`${skippedCount} skipped`);
    }
    const summary = `Results: ${summaryParts.join(', ')}`;

    if (failedCount === 0) {
      logger.success(summary);
      process.exit(ExitCodes.SUCCESS);
    } else {
      logger.warn(summary);
      process.exit(ExitCodes.VALIDATION_FAILED);
    }
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes('ENOENT') || error.message.includes('not found')) {
        logger.error(`File not found: ${specPath}`);
        process.exit(ExitCodes.FILE_NOT_FOUND);
      }
      logger.error(`Error: ${error.message}`);
    } else {
      logger.error('An unexpected error occurred');
    }
    process.exit(ExitCodes.VALIDATION_FAILED);
  }
}
