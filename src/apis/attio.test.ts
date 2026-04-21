import { describe, it, expect, vi, beforeEach } from 'vitest';

const { httpMock } = vi.hoisted(() => ({
  httpMock: {
    post: vi.fn(),
    patch: vi.fn(),
    put: vi.fn(),
  },
}));

vi.mock('axios', () => ({
  default: {
    create: () => httpMock,
  },
}));

const { findCompanyByDomain, findCompanyByName, createCompany, updateCompany, upsertCompanyByDomain, fetchAllRecords } =
  await import('./attio.js');

beforeEach(() => {
  httpMock.post.mockReset();
  httpMock.patch.mockReset();
  httpMock.put.mockReset();
});

describe('findCompanyByDomain', () => {
  it('POSTs a filter query to the records/query endpoint', async () => {
    httpMock.post.mockResolvedValue({ data: { data: [] } });
    await findCompanyByDomain('acme.com');
    expect(httpMock.post).toHaveBeenCalledWith(
      expect.stringMatching(/\/objects\/.+\/records\/query$/),
      { filter: { domain: { $eq: 'acme.com' } }, limit: 1 }
    );
  });

  it('returns null when no records are returned', async () => {
    httpMock.post.mockResolvedValue({ data: { data: [] } });
    expect(await findCompanyByDomain('missing.com')).toBeNull();
  });

  it('returns null when the response data array is missing', async () => {
    httpMock.post.mockResolvedValue({ data: {} });
    expect(await findCompanyByDomain('missing.com')).toBeNull();
  });

  it('extracts the record_id shape into .id', async () => {
    httpMock.post.mockResolvedValue({
      data: { data: [{ id: { record_id: 'rec_123' }, values: { domain: 'acme.com' } }] },
    });
    const out = await findCompanyByDomain('acme.com');
    expect(out).toEqual({ id: 'rec_123', values: { domain: 'acme.com' } });
  });

  it('falls back to a plain id when record_id shape is absent', async () => {
    httpMock.post.mockResolvedValue({
      data: { data: [{ id: 'rec_plain', values: { domain: 'acme.com' } }] },
    });
    const out = await findCompanyByDomain('acme.com');
    expect(out?.id).toBe('rec_plain');
  });

  it('defaults values to {} when missing', async () => {
    httpMock.post.mockResolvedValue({
      data: { data: [{ id: { record_id: 'rec_1' } }] },
    });
    const out = await findCompanyByDomain('acme.com');
    expect(out?.values).toEqual({});
  });
});

describe('findCompanyByName', () => {
  it('queries by company_name and returns the domain on match', async () => {
    httpMock.post.mockResolvedValue({
      data: { data: [{ id: { record_id: 'rec_1' }, values: { domain: [{ domain_name: 'acme.com' }] } }] },
    });
    const domain = await findCompanyByName('Acme');
    expect(httpMock.post).toHaveBeenCalledWith(
      expect.stringMatching(/\/records\/query$/),
      { filter: { company_name: { $eq: 'Acme' } }, limit: 1 }
    );
    expect(domain).toBe('acme.com');
  });

  it('returns null when no records match', async () => {
    httpMock.post.mockResolvedValue({ data: { data: [] } });
    expect(await findCompanyByName('Unknown Co')).toBeNull();
  });

  it('returns null when the matched record has no domain', async () => {
    httpMock.post.mockResolvedValue({
      data: { data: [{ id: { record_id: 'rec_1' }, values: { company_name: [{ value: 'Acme' }] } }] },
    });
    expect(await findCompanyByName('Acme')).toBeNull();
  });
});

describe('createCompany', () => {
  it('maps column names to Attio field slugs in the values payload', async () => {
    httpMock.post.mockResolvedValue({ data: { data: { id: { record_id: 'rec_1' }, values: {} } } });
    await createCompany({
      'Company Name': 'Acme',
      Domain: 'acme.com',
      'Digital Native': 'Digital-native B2C',
    });
    expect(httpMock.post).toHaveBeenCalledWith(
      expect.stringMatching(/\/objects\/.+\/records$/),
      {
        data: {
          values: {
            company_name: 'Acme',
            domain: 'acme.com',
            digital_native: 'Digital-native B2C',
          },
        },
      }
    );
  });

  it('skips empty-string values so Attio is not overwritten with blanks', async () => {
    httpMock.post.mockResolvedValue({ data: { data: { id: 'rec_1', values: {} } } });
    await createCompany({ 'Company Name': 'Acme', Domain: 'acme.com', 'Cloud Tool': '' });
    const body = httpMock.post.mock.calls[0]![1];
    expect(body.data.values).not.toHaveProperty('cloud_tool');
    expect(body.data.values.company_name).toBe('Acme');
  });

  it('skips unknown column keys (no slug mapping)', async () => {
    httpMock.post.mockResolvedValue({ data: { data: { id: 'rec_1', values: {} } } });
    await createCompany({
      'Company Name': 'Acme',
      'Something Weird': 'x',
    } as unknown as Parameters<typeof createCompany>[0]);
    const body = httpMock.post.mock.calls[0]![1];
    expect(Object.keys(body.data.values)).toEqual(['company_name']);
  });

  it('returns the created record id and values', async () => {
    httpMock.post.mockResolvedValue({
      data: { data: { id: { record_id: 'rec_42' }, values: { company_name: 'Acme' } } },
    });
    const out = await createCompany({ 'Company Name': 'Acme' });
    expect(out).toEqual({ id: 'rec_42', values: { company_name: 'Acme' } });
  });
});

describe('updateCompany', () => {
  it('PATCHes the record with mapped values', async () => {
    httpMock.patch.mockResolvedValue({ data: {} });
    await updateCompany('rec_7', { 'Digital Native': 'foo' });
    expect(httpMock.patch).toHaveBeenCalledWith(
      expect.stringMatching(/\/records\/rec_7$/),
      { data: { values: { digital_native: 'foo' } } }
    );
  });
});

describe('fetchAllRecords', () => {
  function makeRecord(domain: string, extraValues: Record<string, Array<{ value?: string; domain_name?: string }>> = {}) {
    return {
      id: { record_id: `rec_${domain}` },
      values: {
        domain: [{ domain_name: domain }],
        ...extraValues,
      },
    };
  }

  it('returns a Map keyed by domain for matching input domains', async () => {
    httpMock.post.mockResolvedValue({
      data: { data: [makeRecord('acme.com'), makeRecord('stripe.com')] },
    });

    const map = await fetchAllRecords(['acme.com', 'stripe.com'], httpMock);

    expect(map.size).toBe(2);
    expect(map.has('acme.com')).toBe(true);
    expect(map.has('stripe.com')).toBe(true);
  });

  it('excludes records whose domain is not in the input list', async () => {
    httpMock.post.mockResolvedValue({
      data: { data: [makeRecord('acme.com'), makeRecord('other.com')] },
    });

    const map = await fetchAllRecords(['acme.com'], httpMock);

    expect(map.size).toBe(1);
    expect(map.has('other.com')).toBe(false);
  });

  it('extracts non-empty field values as slug-keyed strings', async () => {
    httpMock.post.mockResolvedValue({
      data: {
        data: [
          makeRecord('acme.com', {
            digital_native: [{ value: 'Digital-native B2C' }],
            cloud_tool: [{ value: '' }],
          }),
        ],
      },
    });

    const map = await fetchAllRecords(['acme.com'], httpMock);
    const values = map.get('acme.com')!;

    expect(values['digital_native']).toBe('Digital-native B2C');
    expect(values['cloud_tool']).toBeUndefined();
  });

  it('paginates when a full page is returned and stops when partial', async () => {
    const page1 = Array.from({ length: 500 }, (_, i) => makeRecord(`co${i}.com`));
    const page2 = [makeRecord('last.com')];
    httpMock.post
      .mockResolvedValueOnce({ data: { data: page1 } })
      .mockResolvedValueOnce({ data: { data: page2 } });

    const domains = [...page1.map((_, i) => `co${i}.com`), 'last.com'];
    const map = await fetchAllRecords(domains, httpMock);

    expect(httpMock.post).toHaveBeenCalledTimes(2);
    expect(map.has('last.com')).toBe(true);
    expect(map.size).toBe(501);
  });

  it('returns an empty map when Attio returns no records', async () => {
    httpMock.post.mockResolvedValue({ data: { data: [] } });
    const map = await fetchAllRecords(['acme.com'], httpMock);
    expect(map.size).toBe(0);
  });

  it('returns all records when called with no domain filter', async () => {
    httpMock.post.mockResolvedValue({
      data: { data: [makeRecord('acme.com'), makeRecord('other.com'), makeRecord('third.com')] },
    });

    const map = await fetchAllRecords(undefined, httpMock);

    expect(map.size).toBe(3);
    expect(map.has('acme.com')).toBe(true);
    expect(map.has('other.com')).toBe(true);
    expect(map.has('third.com')).toBe(true);
  });

  it('returns all records when called with null filter', async () => {
    httpMock.post.mockResolvedValue({
      data: { data: [makeRecord('acme.com'), makeRecord('other.com')] },
    });

    const map = await fetchAllRecords(null, httpMock);

    expect(map.size).toBe(2);
  });
});

describe('upsertCompanyByDomain', () => {
  it('PUTs with matching_attribute=domain query param', async () => {
    httpMock.put.mockResolvedValue({ data: { data: { id: 'rec_1', values: {} } } });
    await upsertCompanyByDomain({ 'Company Name': 'Acme', Domain: 'acme.com' });
    const [, , config] = httpMock.put.mock.calls[0]!;
    expect(config).toEqual({ params: { matching_attribute: 'domain' } });
  });

  it('sends the values body with mapped slugs', async () => {
    httpMock.put.mockResolvedValue({ data: { data: { id: 'rec_1', values: {} } } });
    await upsertCompanyByDomain({ 'Company Name': 'Acme', Domain: 'acme.com' });
    const [, body] = httpMock.put.mock.calls[0]!;
    expect(body).toEqual({
      data: { values: { company_name: 'Acme', domain: 'acme.com' } },
    });
  });

  it('returns the upserted record', async () => {
    httpMock.put.mockResolvedValue({
      data: { data: { id: { record_id: 'rec_9' }, values: { domain: 'acme.com' } } },
    });
    const out = await upsertCompanyByDomain({ Domain: 'acme.com' });
    expect(out).toEqual({ id: 'rec_9', values: { domain: 'acme.com' } });
  });
});
