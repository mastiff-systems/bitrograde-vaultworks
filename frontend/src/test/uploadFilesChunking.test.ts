/**
 * MAS-804: uploadFiles() must chunk large drops into sequential requests of at
 * most MAX_FILES_PER_UPLOAD files — the backend 413s any multipart request with
 * more than 10 files (FST_FILES_LIMIT), which used to orphan streamed S3
 * objects and silently swallow the whole batch.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { api, uploadFiles, MAX_FILES_PER_UPLOAD, extractApiErrorMessage } from '../api/client.js';
import type { Asset } from '../api/client.js';

function fakeFile(name: string, bytes: number): File {
  return new File([new Uint8Array(bytes)], name, { type: 'application/octet-stream' });
}

function fakeAsset(name: string): Asset {
  return {
    id: `id-${name}`,
    original_name: name,
    mime_type: 'application/octet-stream',
    size_bytes: 1,
    asset_type: 'other' as Asset['asset_type'],
    thumbnail_key: null,
    description: null,
    uploaded_at: '2026-09-03T00:00:00Z',
    tags: [],
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('uploadFiles chunking (MAS-804)', () => {
  it('sends a single request for 10 or fewer files', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({ data: [fakeAsset('a')] });
    await uploadFiles(Array.from({ length: 10 }, (_, i) => fakeFile(`f${i}.ase`, 4)));
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('splits 11 files into 2 sequential requests of 10 and 1', async () => {
    const batchSizes: number[] = [];
    const post = vi.spyOn(api, 'post').mockImplementation(async (_url, form) => {
      const files = (form as FormData).getAll('files');
      batchSizes.push(files.length);
      return { data: files.map((_, i) => fakeAsset(`b${batchSizes.length}-${i}`)) };
    });

    const result = await uploadFiles(Array.from({ length: 11 }, (_, i) => fakeFile(`f${i}.ase`, 4)));

    expect(post).toHaveBeenCalledTimes(2);
    expect(batchSizes).toEqual([MAX_FILES_PER_UPLOAD, 1]);
    // All 11 uploaded assets are returned in order
    expect(result).toHaveLength(11);
  });

  it('reports aggregate byte-weighted progress across chunks', async () => {
    const reported: number[] = [];
    vi.spyOn(api, 'post').mockImplementation(async (_url, form, config) => {
      const files = (form as FormData).getAll('files') as File[];
      const total = files.reduce((s, f) => s + f.size, 0);
      config?.onUploadProgress?.({ loaded: total, total } as Parameters<
        NonNullable<NonNullable<typeof config>['onUploadProgress']>
      >[0]);
      return { data: files.map((_, i) => fakeAsset(`p${i}`)) };
    });

    // 10 files × 10 bytes + 1 file × 100 bytes = 200 bytes total
    const files = [
      ...Array.from({ length: 10 }, (_, i) => fakeFile(`f${i}.ase`, 10)),
      fakeFile('big.ase', 100),
    ];
    await uploadFiles(files, (pct) => reported.push(pct));

    // First chunk completes at 100/200 bytes → 50%; second at 200/200 → 100%.
    expect(reported).toEqual([50, 100]);
  });
});

describe('extractApiErrorMessage (MAS-804)', () => {
  it('surfaces the backend JSON error message', () => {
    const err = { response: { status: 413, data: { error: 'Too many files — maximum 10 per upload.' } } };
    expect(extractApiErrorMessage(err, 'fallback')).toBe('Too many files — maximum 10 per upload.');
  });

  it('falls back for errors without a response body', () => {
    expect(extractApiErrorMessage(new Error('network'), 'fallback')).toBe('fallback');
  });
});
