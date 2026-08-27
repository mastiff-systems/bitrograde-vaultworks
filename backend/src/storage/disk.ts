import { promises as fs } from 'fs';
import path from 'path';
import type { Readable } from 'stream';
import { createReadStream } from 'fs';
import { getDiskConfig } from '../db/settings.js';
import { StorageNotFoundError } from './provider.js';
import type { StorageProvider } from './provider.js';

export class DiskStorageProvider implements StorageProvider {
  private async getBasePath(): Promise<string> {
    const cfg = await getDiskConfig();
    return cfg.storagePath;
  }

  private resolvePath(basePath: string, key: string): string {
    // Key maps directly to {basePath}/{key} — mirrors S3 key format exactly
    return path.join(basePath, key);
  }

  async upload(key: string, body: Buffer, contentType: string): Promise<void> {
    const basePath = await this.getBasePath();
    const dest = this.resolvePath(basePath, key);
    const tmp = `${dest}.tmp`;
    try {
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.writeFile(tmp, body);
      await fs.rename(tmp, dest);
    } catch (err) {
      console.error(`[disk] upload failed: key=${key} error=${(err as Error).message}`);
      // Clean up temp file on failure
      await fs.unlink(tmp).catch(() => undefined);
      throw err;
    }
  }

  async streamUpload(key: string, body: Readable, contentType: string): Promise<void> {
    const basePath = await this.getBasePath();
    const dest = this.resolvePath(basePath, key);
    const tmp = `${dest}.tmp`;
    try {
      await fs.mkdir(path.dirname(dest), { recursive: true });
      const { createWriteStream } = await import('fs');
      const writeStream = createWriteStream(tmp);
      await new Promise<void>((resolve, reject) => {
        body.pipe(writeStream);
        writeStream.on('finish', resolve);
        writeStream.on('error', reject);
        body.on('error', reject);
      });
      await fs.rename(tmp, dest);
    } catch (err) {
      console.error(`[disk] streamUpload failed: key=${key} error=${(err as Error).message}`);
      await fs.unlink(tmp).catch(() => undefined);
      throw err;
    }
  }

  async download(key: string): Promise<{ stream: Readable; contentType?: string; contentLength?: number }> {
    const basePath = await this.getBasePath();
    const filePath = this.resolvePath(basePath, key);
    try {
      const stat = await fs.stat(filePath);
      const stream = createReadStream(filePath);
      return {
        stream,
        contentLength: stat.size,
        // contentType is not stored on disk; caller must derive from DB metadata
        contentType: undefined,
      };
    } catch (err) {
      console.error(`[disk] download failed: key=${key} error=${(err as Error).message}`);
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    const basePath = await this.getBasePath();
    const filePath = this.resolvePath(basePath, key);
    try {
      await fs.unlink(filePath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        // File already gone — treat as success
        return;
      }
      console.error(`[disk] delete failed: key=${key} error=${(err as Error).message}`);
      throw err;
    }
  }

  async copy(sourceKey: string, destKey: string): Promise<void> {
    const basePath = await this.getBasePath();
    const src = this.resolvePath(basePath, sourceKey);
    const dest = this.resolvePath(basePath, destKey);
    try {
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.copyFile(src, dest);
    } catch (err) {
      console.error(`[disk] copy failed: sourceKey=${sourceKey} destKey=${destKey} error=${(err as Error).message}`);
      throw err;
    }
  }

  async move(sourceKey: string, destKey: string): Promise<void> {
    const basePath = await this.getBasePath();
    const src = this.resolvePath(basePath, sourceKey);
    const dest = this.resolvePath(basePath, destKey);
    try {
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.rename(src, dest);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        throw new StorageNotFoundError(sourceKey, err);
      }
      if (code === 'EXDEV') {
        // Cross-device rename not supported — fall back to copy + best-effort unlink
        await this.copy(sourceKey, destKey);
        await fs.unlink(src).catch((unlinkErr) => {
          console.error(`[disk] move: failed to delete source "${sourceKey}" after copy:`, unlinkErr);
        });
        return;
      }
      console.error(`[disk] move failed: sourceKey=${sourceKey} destKey=${destKey} error=${(err as Error).message}`);
      throw err;
    }
  }
}
