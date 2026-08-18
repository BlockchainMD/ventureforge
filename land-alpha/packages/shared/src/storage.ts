import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile, readdir, unlink } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { ConfigurationError, NotFoundError } from './errors.js';
import { env } from './env.js';

/**
 * Object storage abstraction.
 *
 * Provenance requires that we keep the *bytes we actually parsed*, not just a
 * URL that may 404 next week. Every ingestion run writes its source artefacts
 * here (PDFs, CSVs, HTML snapshots, GIS extracts), and every generated asset
 * (parcel reports, marketing packages) is written here too.
 *
 * Local development uses the filesystem driver; production uses any
 * S3-compatible endpoint (AWS S3, MinIO, R2, B2).
 */

export interface PutOptions {
  readonly contentType?: string;
  readonly metadata?: Record<string, string>;
}

export interface StoredObject {
  readonly key: string;
  readonly size: number;
  readonly contentType: string | null;
  readonly sha256: string;
  readonly storedAt: Date;
}

export interface ObjectStorage {
  put(key: string, body: Buffer | string, options?: PutOptions): Promise<StoredObject>;
  get(key: string): Promise<Buffer>;
  exists(key: string): Promise<boolean>;
  list(prefix: string): Promise<string[]>;
  delete(key: string): Promise<void>;
  /** A URL the app can serve the object from. Not necessarily public. */
  urlFor(key: string): string;
}

/**
 * Keys are namespaced so an operator can reason about the bucket without a
 * database: `raw/<sourceId>/<yyyy-mm-dd>/<hash>.<ext>` etc.
 */
export const StorageKeys = {
  rawArtifact(sourceId: string, runId: string, filename: string): string {
    return `raw/${sourceId}/${runId}/${sanitizeSegment(filename)}`;
  },
  parcelDocument(parcelId: string, filename: string): string {
    return `parcels/${parcelId}/documents/${sanitizeSegment(filename)}`;
  },
  parcelReport(parcelId: string, filename: string): string {
    return `parcels/${parcelId}/reports/${sanitizeSegment(filename)}`;
  },
  listingAsset(parcelId: string, filename: string): string {
    return `listings/${parcelId}/${sanitizeSegment(filename)}`;
  },
  dealDocument(dealId: string, filename: string): string {
    return `deals/${dealId}/${sanitizeSegment(filename)}`;
  },
  manualImport(importId: string, filename: string): string {
    return `imports/${importId}/${sanitizeSegment(filename)}`;
  },
};

function sanitizeSegment(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '');
  return cleaned.length > 0 ? cleaned.slice(0, 160) : 'object';
}

export class FilesystemStorage implements ObjectStorage {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  private pathFor(key: string): string {
    const target = resolve(join(this.root, key));
    // Defence in depth: a crafted key must never escape the storage root.
    if (target !== this.root && !target.startsWith(this.root + sep)) {
      throw new ConfigurationError(`Storage key escapes root: ${key}`);
    }
    return target;
  }

  async put(key: string, body: Buffer | string, options: PutOptions = {}): Promise<StoredObject> {
    const buffer = typeof body === 'string' ? Buffer.from(body, 'utf8') : body;
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, buffer);
    if (options.contentType || options.metadata) {
      await writeFile(
        `${path}.meta.json`,
        JSON.stringify(
          { contentType: options.contentType ?? null, metadata: options.metadata ?? {} },
          null,
          2,
        ),
      );
    }
    return {
      key,
      size: buffer.byteLength,
      contentType: options.contentType ?? null,
      sha256: createHash('sha256').update(buffer).digest('hex'),
      storedAt: new Date(),
    };
  }

  async get(key: string): Promise<Buffer> {
    try {
      return await readFile(this.pathFor(key));
    } catch {
      throw new NotFoundError(`Object not found: ${key}`, { key });
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await stat(this.pathFor(key));
      return true;
    } catch {
      return false;
    }
  }

  async list(prefix: string): Promise<string[]> {
    const base = this.pathFor(prefix);
    const out: string[] = [];
    const walk = async (dir: string, rel: string): Promise<void> => {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const relPath = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.isDirectory()) await walk(join(dir, entry.name), relPath);
        else if (!entry.name.endsWith('.meta.json')) out.push(`${prefix}/${relPath}`);
      }
    };
    await walk(base, '');
    return out.sort();
  }

  async delete(key: string): Promise<void> {
    try {
      await unlink(this.pathFor(key));
    } catch {
      /* already gone */
    }
  }

  urlFor(key: string): string {
    return `/api/storage/${key.split('/').map(encodeURIComponent).join('/')}`;
  }
}

interface MinimalS3Client {
  send(command: unknown): Promise<unknown>;
}

/**
 * S3-compatible driver. `@aws-sdk/client-s3` is imported lazily so that the
 * dependency is only loaded when object storage is actually configured for S3.
 */
export class S3Storage implements ObjectStorage {
  private client: MinimalS3Client | null = null;
  private commands: Record<string, new (input: unknown) => unknown> | null = null;

  constructor(
    private readonly bucket: string,
    private readonly config: {
      region?: string;
      endpoint?: string;
      accessKeyId?: string;
      secretAccessKey?: string;
      forcePathStyle?: boolean;
    },
  ) {}

  private async sdk(): Promise<{
    client: MinimalS3Client;
    commands: Record<string, new (input: unknown) => unknown>;
  }> {
    if (this.client && this.commands) return { client: this.client, commands: this.commands };
    let mod: Record<string, unknown>;
    try {
      // Bare specifier kept out of the static import graph: the SDK is an
      // optional peer, so a filesystem-only deployment never installs it.
      const specifier = '@aws-sdk/client-s3';
      mod = (await import(/* @vite-ignore */ specifier)) as unknown as Record<string, unknown>;
    } catch (cause) {
      throw new ConfigurationError(
        'STORAGE_DRIVER=s3 requires the optional dependency @aws-sdk/client-s3. Install it with `pnpm add -w @aws-sdk/client-s3`.',
        { cause: String(cause) },
      );
    }
    const S3Client = mod.S3Client as new (config: unknown) => MinimalS3Client;
    this.client = new S3Client({
      region: this.config.region ?? 'us-east-1',
      endpoint: this.config.endpoint,
      forcePathStyle: this.config.forcePathStyle ?? true,
      credentials:
        this.config.accessKeyId && this.config.secretAccessKey
          ? {
              accessKeyId: this.config.accessKeyId,
              secretAccessKey: this.config.secretAccessKey,
            }
          : undefined,
    });
    this.commands = {
      PutObjectCommand: mod.PutObjectCommand as new (input: unknown) => unknown,
      GetObjectCommand: mod.GetObjectCommand as new (input: unknown) => unknown,
      HeadObjectCommand: mod.HeadObjectCommand as new (input: unknown) => unknown,
      ListObjectsV2Command: mod.ListObjectsV2Command as new (input: unknown) => unknown,
      DeleteObjectCommand: mod.DeleteObjectCommand as new (input: unknown) => unknown,
    };
    return { client: this.client, commands: this.commands };
  }

  async put(key: string, body: Buffer | string, options: PutOptions = {}): Promise<StoredObject> {
    const { client, commands } = await this.sdk();
    const buffer = typeof body === 'string' ? Buffer.from(body, 'utf8') : body;
    await client.send(
      new commands.PutObjectCommand!({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: options.contentType,
        Metadata: options.metadata,
      }),
    );
    return {
      key,
      size: buffer.byteLength,
      contentType: options.contentType ?? null,
      sha256: createHash('sha256').update(buffer).digest('hex'),
      storedAt: new Date(),
    };
  }

  async get(key: string): Promise<Buffer> {
    const { client, commands } = await this.sdk();
    const response = (await client.send(
      new commands.GetObjectCommand!({ Bucket: this.bucket, Key: key }),
    )) as { Body?: { transformToByteArray(): Promise<Uint8Array> } };
    if (!response.Body) throw new NotFoundError(`Object not found: ${key}`, { key });
    return Buffer.from(await response.Body.transformToByteArray());
  }

  async exists(key: string): Promise<boolean> {
    const { client, commands } = await this.sdk();
    try {
      await client.send(new commands.HeadObjectCommand!({ Bucket: this.bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }

  async list(prefix: string): Promise<string[]> {
    const { client, commands } = await this.sdk();
    const response = (await client.send(
      new commands.ListObjectsV2Command!({ Bucket: this.bucket, Prefix: prefix }),
    )) as { Contents?: { Key?: string }[] };
    return (response.Contents ?? []).map((o) => o.Key).filter((k): k is string => Boolean(k));
  }

  async delete(key: string): Promise<void> {
    const { client, commands } = await this.sdk();
    await client.send(new commands.DeleteObjectCommand!({ Bucket: this.bucket, Key: key }));
  }

  urlFor(key: string): string {
    return `/api/storage/${key.split('/').map(encodeURIComponent).join('/')}`;
  }
}

let cachedStorage: ObjectStorage | null = null;

export function getStorage(): ObjectStorage {
  if (cachedStorage) return cachedStorage;
  const config = env();
  if (config.STORAGE_DRIVER === 's3') {
    if (!config.S3_BUCKET) throw new ConfigurationError('STORAGE_DRIVER=s3 requires S3_BUCKET');
    cachedStorage = new S3Storage(config.S3_BUCKET, {
      region: config.S3_REGION,
      endpoint: config.S3_ENDPOINT,
      accessKeyId: config.S3_ACCESS_KEY_ID,
      secretAccessKey: config.S3_SECRET_ACCESS_KEY,
      forcePathStyle: config.S3_FORCE_PATH_STYLE,
    });
  } else {
    cachedStorage = new FilesystemStorage(config.STORAGE_LOCAL_DIR);
  }
  return cachedStorage;
}

export function setStorage(storage: ObjectStorage | null): void {
  cachedStorage = storage;
}
