import { SpecValidator } from '../../validators/spec-validator.js';
import { loadSpec } from '../../utils/loader.js';
import { logger } from '../../utils/logger.js';
import { ExitCodes, type ValidationError } from '../../utils/types.js';

interface ValidateSpecOptions {
  strict: boolean;
}

function formatError(error: ValidationError, index: number): void {
  const prefix = `${index + 1}.`;
  const typeLabel = getErrorTypeLabel(error.type);

  logger.errorDetail(`${prefix} [${typeLabel}] ${error.message}`);

  if (error.path) {
    logger.errorDetail(`   Path: ${error.path}`);
  }

  if (error.details) {
    logger.errorDetail(`   Details: ${error.details}`);
  }
}

function getErrorTypeLabel(type: ValidationError['type']): string {
  switch (type) {
    case 'syntax-error':
      return 'SYNTAX';
    case 'missing-field':
      return 'MISSING FIELD';
    case 'invalid-type':
      return 'INVALID TYPE';
    case 'ref-error':
      return 'REF ERROR';
    case 'validation-error':
      return 'VALIDATION';
    case 'warning-as-error':
      return 'STRICT';
    default:
      return 'ERROR';
  }
}

export async function validateSpecCommand(
  specPath: string,
  options: ValidateSpecOptions
): Promise<void> {
  logger.info(`Validating OpenAPI specification: ${specPath}\n`);

  try {
    // Load the spec file
    const rawSpec = await loadSpec(specPath);

    // Create validator and validate
    const validator = new SpecValidator(options.strict);
    const result = await validator.validate(rawSpec, specPath);

    if (result.valid) {
      logger.success('OpenAPI specification is valid!\n');

      if (result.info) {
        logger.info('Specification Details:');
        logger.detail('Title', result.info.title);
        logger.detail('Version', result.info.version);
        if (result.info.openApiVersion) {
          logger.detail('OpenAPI Version', result.info.openApiVersion);
        }
        if (result.info.pathCount !== undefined) {
          logger.detail('Paths', result.info.pathCount.toString());
        }
        if (result.info.schemaCount !== undefined) {
          logger.detail('Schemas', result.info.schemaCount.toString());
        }
      }

      if (result.warnings && result.warnings.length > 0) {
        logger.warn(`\nWarnings (${result.warnings.length}):`);
        result.warnings.forEach((warning, index) => {
          logger.warn(`  ${index + 1}. ${warning}`);
        });
      }

      process.exit(ExitCodes.SUCCESS);
    } else {
      logger.error('OpenAPI specification is invalid!\n');

      if (result.errors && result.errors.length > 0) {
        // Group errors by type for better readability
        const errorsByType = groupErrorsByType(result.errors);

        logger.error(`Found ${result.errors.length} error(s):\n`);

        let errorIndex = 0;
        for (const [type, errors] of Object.entries(errorsByType)) {
          for (const error of errors) {
            formatError(error, errorIndex++);
          }
        }
      }

      if (result.warnings && result.warnings.length > 0) {
        logger.warn(`\nWarnings (${result.warnings.length}):`);
        result.warnings.forEach((warning, index) => {
          logger.warn(`  ${index + 1}. ${warning}`);
        });
      }

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

function groupErrorsByType(errors: ValidationError[]): Record<string, ValidationError[]> {
  return errors.reduce((acc, error) => {
    if (!acc[error.type]) {
      acc[error.type] = [];
    }
    acc[error.type].push(error);
    return acc;
  }, {} as Record<string, ValidationError[]>);
}
