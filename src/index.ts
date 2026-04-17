import { Command } from 'commander';
import { enrichAll } from './commands/enrichAll.js';
import { enrichCompany } from './commands/enrichCompany.js';
import { enrichColumn } from './commands/enrichColumn.js';

const program = new Command();

program
  .name('gtm-enrich')
  .description('Enrich company data via Apify, Exa, TheirStack, Azure OpenAI → write to Attio');

program
  .command('enrich-all')
  .description('Bulk enrich every company from the CSV into Attio (create missing, fill gaps on existing)')
  .option('--csv <path>', 'path to input CSV (default: ./data/input.csv)')
  .option('--limit <n>', 'process only the first N rows', (v) => parseInt(v, 10))
  .option('--dry-run', 'show what would be created/updated without calling any APIs')
  .action(async (opts) => {
    await enrichAll(opts);
  });

program
  .command('enrich-company')
  .description('Enrich all columns for a single company (create if missing in Attio, update otherwise)')
  .requiredOption('--domain <domain>', 'company domain, e.g. acme.com')
  .option('--csv <path>', 'path to input CSV (default: ./data/input.csv)')
  .option('--dry-run', 'show what would happen without calling any APIs')
  .action(async (opts) => {
    await enrichCompany(opts);
  });

program
  .command('enrich-column')
  .description('Overwrite a single column for a single company in Attio (company must already exist)')
  .requiredOption('--column <column>', 'exact column name, e.g. "Cloud Tool (Exa)"')
  .requiredOption('--domain <domain>', 'company domain, e.g. acme.com')
  .option('--csv <path>', 'path to input CSV (default: ./data/input.csv)')
  .option('--dry-run', 'show what would happen without calling any APIs')
  .action(async (opts) => {
    await enrichColumn(opts);
  });

program.parseAsync(process.argv).catch((err) => {
  console.error('[fatal]', err instanceof Error ? err.message : err);
  process.exit(1);
});
