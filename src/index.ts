import { Command } from 'commander';
import axios from 'axios';
import { enrichAll } from './commands/enrichAll.js';

const program = new Command();

program
  .name('gtm-enrich')
  .description('Enrich company data via Apify, Exa, TheirStack, Azure OpenAI → write to Attio');

program
  .command('enrich-all')
  .description('Bulk enrich every company from the CSV into Attio (create missing, fill gaps on existing)')
  .option('--csv <path>', 'path to input CSV (default: ./data/input.csv)')
  .option('--limit <n>', 'process only the first N rows', (v) => parseInt(v, 10))
  .option('--account-purpose <value>', 'tag every CSV-sourced row written this run with this value (Account Purpose column); omit to leave the column untouched')
  .action(async (opts) => {
    await enrichAll(opts);
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
