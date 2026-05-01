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

const { findCompanyByDomain, createCompany, updateCompany, upsertCompanyByDomain, fetchAllRecords, FIELD_SLUGS } =
  await import('./attio.js');

const DOMAIN_SLUG = FIELD_SLUGS['Domain']!;
const COMPANY_NAME_SLUG = FIELD_SLUGS['Company Name']!;
const DESCRIPTION_SLUG = FIELD_SLUGS['Description']!;
const DIGITAL_NATIVE_SLUG = FIELD_SLUGS['Digital Native']!;
const CLOUD_TOOL_SLUG = FIELD_SLUGS['Cloud Tool']!;

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
      { filter: { [DOMAIN_SLUG]: { $eq: 'acme.com' } }, limit: 1 }
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
      data: { data: [{ id: { record_id: 'rec_123' }, values: { [DOMAIN_SLUG]: 'acme.com' } }] },
    });
    const out = await findCompanyByDomain('acme.com');
    expect(out).toEqual({ id: 'rec_123', values: { [DOMAIN_SLUG]: 'acme.com' } });
  });

  it('falls back to a plain id when record_id shape is absent', async () => {
    httpMock.post.mockResolvedValue({
      data: { data: [{ id: 'rec_plain', values: { [DOMAIN_SLUG]: 'acme.com' } }] },
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
            [COMPANY_NAME_SLUG]: 'Acme',
            [DOMAIN_SLUG]: [{ domain: 'acme.com' }],
            [DIGITAL_NATIVE_SLUG]: 'Digital-native B2C',
          },
        },
      }
    );
  });

  it('skips empty-string values so Attio is not overwritten with blanks', async () => {
    httpMock.post.mockResolvedValue({ data: { data: { id: 'rec_1', values: {} } } });
    await createCompany({ 'Company Name': 'Acme', Domain: 'acme.com', 'Cloud Tool': '' });
    const body = httpMock.post.mock.calls[0]![1];
    expect(body.data.values).not.toHaveProperty(CLOUD_TOOL_SLUG);
    expect(body.data.values[COMPANY_NAME_SLUG]).toBe('Acme');
  });

  it('skips unknown column keys (no slug mapping)', async () => {
    httpMock.post.mockResolvedValue({ data: { data: { id: 'rec_1', values: {} } } });
    await createCompany({
      'Company Name': 'Acme',
      'Something Weird': 'x',
    } as unknown as Parameters<typeof createCompany>[0]);
    const body = httpMock.post.mock.calls[0]![1];
    expect(Object.keys(body.data.values)).toEqual([COMPANY_NAME_SLUG]);
  });

  it('returns the created record id and values', async () => {
    httpMock.post.mockResolvedValue({
      data: { data: { id: { record_id: 'rec_42' }, values: { [COMPANY_NAME_SLUG]: 'Acme' } } },
    });
    const out = await createCompany({ 'Company Name': 'Acme' });
    expect(out).toEqual({ id: 'rec_42', values: { [COMPANY_NAME_SLUG]: 'Acme' } });
  });
});

describe('updateCompany', () => {
  it('PATCHes the record with mapped values', async () => {
    httpMock.patch.mockResolvedValue({ data: {} });
    await updateCompany('rec_7', { 'Digital Native': 'foo' });
    expect(httpMock.patch).toHaveBeenCalledWith(
      expect.stringMatching(/\/records\/rec_7$/),
      { data: { values: { [DIGITAL_NATIVE_SLUG]: 'foo' } } }
    );
  });
});

describe('fetchAllRecords', () => {
  function makeRecord(domain: string, extraValues: Record<string, Array<{ value?: string; domain_name?: string }>> = {}) {
    return {
      id: { record_id: `rec_${domain}` },
      values: {
        [DOMAIN_SLUG]: [{ domain_name: domain }],
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
            [DIGITAL_NATIVE_SLUG]: [{ value: 'Digital-native B2C' }],
            [CLOUD_TOOL_SLUG]: [{ value: '' }],
          }),
        ],
      },
    });

    const map = await fetchAllRecords(['acme.com'], httpMock);
    const values = map.get('acme.com')!;

    expect(values[DIGITAL_NATIVE_SLUG]).toBe('Digital-native B2C');
    expect(values[CLOUD_TOOL_SLUG]).toBeUndefined();
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

  it('pushes a $or domain filter into the query body when called with a domain list', async () => {
    httpMock.post.mockResolvedValue({ data: { data: [makeRecord('acme.com')] } });

    await fetchAllRecords(['acme.com', 'beta.com'], httpMock);

    const [, body] = httpMock.post.mock.calls[0]!;
    expect(body).toEqual({
      limit: 500,
      offset: 0,
      filter: { $or: [{ [DOMAIN_SLUG]: 'acme.com' }, { [DOMAIN_SLUG]: 'beta.com' }] },
    });
  });

  it('omits the filter clause when called with no domain list', async () => {
    httpMock.post.mockResolvedValue({ data: { data: [] } });

    await fetchAllRecords(undefined, httpMock);

    const [, body] = httpMock.post.mock.calls[0]!;
    expect(body).toEqual({ limit: 500, offset: 0 });
  });

  it('short-circuits and makes no request when called with an empty domain list', async () => {
    const map = await fetchAllRecords([], httpMock);

    expect(httpMock.post).not.toHaveBeenCalled();
    expect(map.size).toBe(0);
  });
});

describe('upsertCompanyByDomain', () => {
  it('PUTs with matching_attribute=<domain slug> query param', async () => {
    httpMock.put.mockResolvedValue({ data: { data: { id: 'rec_1', values: {} } } });
    await upsertCompanyByDomain({ 'Company Name': 'Acme', Domain: 'acme.com' });
    const [, , config] = httpMock.put.mock.calls[0]!;
    expect(config).toEqual({ params: { matching_attribute: DOMAIN_SLUG } });
  });

  it('sends the values body with mapped slugs', async () => {
    httpMock.put.mockResolvedValue({ data: { data: { id: 'rec_1', values: {} } } });
    await upsertCompanyByDomain({ 'Company Name': 'Acme', Domain: 'acme.com' });
    const [, body] = httpMock.put.mock.calls[0]!;
    expect(body).toEqual({
      data: { values: { [COMPANY_NAME_SLUG]: 'Acme', [DOMAIN_SLUG]: [{ domain: 'acme.com' }] } },
    });
  });

  it('maps Description to the description slug', async () => {
    httpMock.put.mockResolvedValue({ data: { data: { id: 'rec_1', values: {} } } });
    await upsertCompanyByDomain({ Domain: 'acme.com', Description: 'A widget company' });
    const [, body] = httpMock.put.mock.calls[0]!;
    expect(body.data.values).toEqual({ [DOMAIN_SLUG]: [{ domain: 'acme.com' }], [DESCRIPTION_SLUG]: 'A widget company' });
  });

  it('returns the upserted record', async () => {
    httpMock.put.mockResolvedValue({
      data: { data: { id: { record_id: 'rec_9' }, values: { [DOMAIN_SLUG]: 'acme.com' } } },
    });
    const out = await upsertCompanyByDomain({ Domain: 'acme.com' });
    expect(out).toEqual({ id: 'rec_9', values: { [DOMAIN_SLUG]: 'acme.com' } });
  });
});
