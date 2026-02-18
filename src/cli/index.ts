import { Command } from 'commander';
import { validateSpecCommand } from './commands/validate-spec.js';
import { validateApiCommand } from './commands/validate-api.js';

const program = new Command();

program
  .name('openapi-auto-validator')
  .description('CLI tool to validate OpenAPI/Swagger specs and live API responses')
  .version('1.0.0');

program
  .command('validate-spec')
  .description('Validate an OpenAPI/Swagger specification file')
  .argument('<path>', 'Path to the OpenAPI spec file (YAML or JSON)')
  .option('--strict', 'Enable strict validation mode', false)
  .action(validateSpecCommand);

program
  .command('validate-api')
  .description('Validate live API responses against an OpenAPI spec')
  .argument('<spec>', 'Path to the OpenAPI spec file')
  .requiredOption('-u, --url <baseUrl>', 'Base URL of the API to validate')
  .option('-e, --endpoints <paths>', 'Comma-separated list of endpoints to test')
  .option('-H, --header <headers...>', 'Custom headers in format "Key:Value"')
  .option('--timeout <ms>', 'Request timeout in milliseconds', '5000')
  .action(validateApiCommand);

export function cli(): void {
  program.parse();
}
