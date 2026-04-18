import { describe, it, expect } from 'vitest';
import { enrichColumn } from './enrichColumn.js';

describe('enrichColumn input validation', () => {
  it('throws when the column name is not in ENRICHABLE_COLUMN_LIST', async () => {
    await expect(
      enrichColumn({ domain: 'acme.com', column: 'Not A Real Column' })
    ).rejects.toThrow(/Unknown column/);
  });

  it('includes the valid column list in the error message', async () => {
    await expect(
      enrichColumn({ domain: 'acme.com', column: 'Bogus' })
    ).rejects.toThrow(/Digital Native/);
  });
});
