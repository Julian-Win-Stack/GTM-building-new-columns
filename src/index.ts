import { Command } from 'commander';
import axios from 'axios';
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

program
  .command('attio-smoke')
  .description('Smoke-test Attio: upsert one company (Name + Domain) into ranked_companies by domain')
  .requiredOption('--domain <domain>', 'company domain, e.g. kobie.com')
  .option('--csv <path>', 'path to input CSV (default: ./data/input.csv)')
  .action(async (opts) => {
    const { attioSmoke } = await import('./commands/attioSmoke.js');
    await attioSmoke(opts);
  });

program.parseAsync(process.argv).catch((err) => {
  if (axios.isAxiosError(err)) {
    const method = err.config?.method?.toUpperCase();
    const url = err.config?.url;
    const status = err.response?.status;
    const body = err.response?.data;
    console.error(`[fatal] ${method} ${url} → ${status}`);
    console.error('[fatal] response body:', typeof body === 'string' ? body : JSON.stringify(body, null, 2));
    console.error('[fatal] request body:', err.config?.data);
  } else {
    console.error('[fatal]', err instanceof Error ? err.stack ?? err.message : err);
  }
  process.exit(1);
});
