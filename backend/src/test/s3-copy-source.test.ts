/**
 * MAS-664 – CopySource URL-encoding in S3StorageProvider.copy()
 *
 * The AWS SDK v3 does not URL-encode CopySource (it is sent verbatim in the
 * x-amz-copy-source header), so keys containing spaces, '%', '+', '#' or
 * non-ASCII characters must be encoded by the provider. These tests capture
 * the CopyObjectCommand input via a spy on S3Client.send — no network needed.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { S3Client } from '@aws-sdk/client-s3';
import type { CopyObjectCommand } from '@aws-sdk/client-s3';
import { S3StorageProvider } from '../storage/s3-provider.js';
import { getS3Config } from '../db/settings.js';

vi.mock('../db/settings.js', () => ({
  getS3Config: vi.fn(),
}));

const BASE_CONFIG = {
  endpoint: 'http://localhost:9000',
  bucket: 'test-bucket',
  accessKey: 'test-access',
  secretKey: 'test-secret',
  rootFolderPrefix: '',
  forcePathStyle: true,
};

describe('S3StorageProvider.copy() CopySource encoding (MAS-664)', () => {
  const provider = new S3StorageProvider();
  let sendSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.mocked(getS3Config).mockResolvedValue({ ...BASE_CONFIG });
    sendSpy = vi.spyOn(S3Client.prototype, 'send').mockResolvedValue({} as never);
  });

  afterEach(() => {
    sendSpy.mockRestore();
    vi.mocked(getS3Config).mockReset();
  });

  async function copySourceFor(sourceKey: string, destKey: string) {
    await provider.copy(sourceKey, destKey);
    expect(sendSpy).toHaveBeenCalledTimes(1);
    const cmd = sendSpy.mock.calls[0][0] as CopyObjectCommand;
    return cmd.input;
  }

  it('encodes spaces, parentheses and % in CopySource; Key stays raw', async () => {
    const key = 'trash/abc-123/my file (1) 100%.png';
    const input = await copySourceFor('assets/abc-123/my file (1) 100%.png', key);
    expect(input.CopySource).toBe('test-bucket/assets/abc-123/my%20file%20(1)%20100%25.png');
    expect(input.Key).toBe(key);
    expect(input.Bucket).toBe('test-bucket');
  });

  it('encodes +, # and ? so they cannot be misread as URL syntax', async () => {
    const input = await copySourceFor('assets/id/a+b #1?.txt', 'trash/id/a+b #1?.txt');
    expect(input.CopySource).toBe('test-bucket/assets/id/a%2Bb%20%231%3F.txt');
  });

  it('encodes non-ASCII characters as UTF-8 percent-escapes', async () => {
    const input = await copySourceFor('assets/id/ümlaut-テスト.png', 'trash/id/ümlaut-テスト.png');
    expect(input.CopySource).toBe(
      'test-bucket/assets/id/%C3%BCmlaut-%E3%83%86%E3%82%B9%E3%83%88.png',
    );
  });

  it('leaves already URL-safe keys unchanged (no double-encoding)', async () => {
    const input = await copySourceFor(
      'assets/abc-123/simple_file-1.0.png',
      'trash/abc-123/simple_file-1.0.png',
    );
    expect(input.CopySource).toBe('test-bucket/assets/abc-123/simple_file-1.0.png');
  });

  it('applies the root folder prefix before encoding, preserving / separators', async () => {
    vi.mocked(getS3Config).mockResolvedValue({ ...BASE_CONFIG, rootFolderPrefix: 'vault root/' });
    const input = await copySourceFor('assets/id/my file.png', 'trash/id/my file.png');
    expect(input.CopySource).toBe('test-bucket/vault%20root/assets/id/my%20file.png');
    expect(input.Key).toBe('vault root/trash/id/my file.png');
  });
});
