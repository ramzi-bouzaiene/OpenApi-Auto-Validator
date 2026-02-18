import chalk from 'chalk';

export const logger = {
  info(message: string): void {
    console.log(chalk.blue(message));
  },

  success(message: string): void {
    console.log(chalk.green(message));
  },

  warn(message: string): void {
    console.log(chalk.yellow(message));
  },

  error(message: string): void {
    console.log(chalk.red(message));
  },

  errorDetail(message: string): void {
    console.log(chalk.red(`  ${message}`));
  },

  detail(label: string, value: string): void {
    console.log(`  ${chalk.gray(label + ':')} ${chalk.white(value)}`);
  },

  dim(message: string): void {
    console.log(chalk.dim(message));
  },

  bold(message: string): void {
    console.log(chalk.bold(message));
  },

  table(data: Record<string, string | number>): void {
    const maxKeyLength = Math.max(...Object.keys(data).map(k => k.length));

    for (const [key, value] of Object.entries(data)) {
      const paddedKey = key.padEnd(maxKeyLength);
      console.log(`  ${chalk.gray(paddedKey)}  ${chalk.white(value)}`);
    }
  },

  divider(): void {
    console.log(chalk.dim('─'.repeat(50)));
  },

  newLine(): void {
    console.log('');
  },
};
