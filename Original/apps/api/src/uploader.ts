import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { getApps, initializeApp, cert } from 'firebase-admin/app';
import { getStorage } from 'firebase-admin/storage';
import { getConfig } from './config.js';

/** Generic interface for uploading files to external storage. */
export interface Uploader {
  /** Upload a local file and return the public URL. */
  uploadFile(localPath: string, remoteKey: string): Promise<string>;
  /** Upload an entire directory recursively under a remote prefix. */
  uploadDir(dir: string, prefix: string): Promise<void>;
}

/**
 * Uploader that stores files on the local filesystem.
 * Files are copied into `LOCAL_STORAGE_DIR` and URLs are
 * returned relative to `PUBLIC_BASE`.
 */
export class LocalUploader implements Uploader {
  private baseUrl: string;
  private rootDir: string;

  constructor() {
    const { PUBLIC_BASE, LOCAL_STORAGE_DIR } = getConfig();
    this.baseUrl = PUBLIC_BASE;
    this.rootDir = LOCAL_STORAGE_DIR;
  }

  private async ensureDir(filePath: string) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
  }

  async uploadFile(localPath: string, remoteKey: string): Promise<string> {
    const dest = path.join(this.rootDir, remoteKey);
    await this.ensureDir(dest);
    await fs.copyFile(localPath, dest);
    return `${this.baseUrl.replace(/\/$/, '')}/${remoteKey.replace(/^\//, '')}`;
  }

  async uploadDir(dir: string, prefix: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const localPath = path.join(dir, entry.name);
      const remoteKey = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await this.uploadDir(localPath, remoteKey);
      } else {
        await this.uploadFile(localPath, remoteKey);
      }
    }
  }
}

/** Firebase Storage uploader using the Firebase Admin SDK. */
export class FirebaseUploader implements Uploader {
  private bucketName: string;

  constructor() {
    const { FIREBASE } = getConfig();
    this.bucketName = FIREBASE.storageBucket;
    if (!getApps().length) {
      if (FIREBASE.projectId && FIREBASE.clientEmail && FIREBASE.privateKey) {
        initializeApp({
          credential: cert({
            projectId: FIREBASE.projectId,
            clientEmail: FIREBASE.clientEmail,
            privateKey: FIREBASE.privateKey,
          }),
        });
      } else {
        initializeApp();
      }
    }
  }

  private getBucket() {
    return getStorage().bucket(this.bucketName);
  }

  async uploadFile(localPath: string, remoteKey: string): Promise<string> {
    const bucket = this.getBucket();
    // Normalize and ensure we store under builds/<...>
    let key = remoteKey.replace(/^\/+/, '');
    if (!/^builds\//.test(key)) key = `builds/${key}`;
    await bucket.upload(localPath, {
      destination: key,
    });
    return `https://storage.googleapis.com/${bucket.name}/${key}`;
  }

  async uploadDir(dir: string, prefix: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const localPath = path.join(dir, entry.name);
      const remoteKey = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await this.uploadDir(localPath, remoteKey);
      } else {
        await this.uploadFile(localPath, remoteKey);
      }
    }
  }
}

/** Cloudflare R2 uploader using the S3-compatible API.
 * Supports a dry-run mode for testing without network access.
 */
export interface R2UploaderOptions {
  baseUrl?: string;
  bucket?: string;
  dryRun?: boolean;
}

export class R2Uploader implements Uploader {
  private baseUrl: string;
  private bucket?: string;
  private dryRun: boolean;
  private s3?: any;

  constructor(opts: string | R2UploaderOptions = {}) {
    const options: R2UploaderOptions = typeof opts === 'string' ? { baseUrl: opts } : opts;
    const { APPS_BASE_URL, R2_BUCKET_URL, PUBLIC_BASE, R2_BUCKET } = getConfig();
    this.baseUrl =
      options.baseUrl || APPS_BASE_URL || R2_BUCKET_URL || `${PUBLIC_BASE}/play`;
    this.bucket = options.bucket || R2_BUCKET;
    this.dryRun = options.dryRun ?? false;
  }

  private async getClient() {
    if (this.s3) return this.s3;
    const {
      R2_ACCOUNT_ID,
      R2_ACCESS_KEY_ID,
      R2_SECRET_ACCESS_KEY,
    } = getConfig();
    const mod = await import('@aws-sdk/client-s3').catch(() => undefined as any);
    if (!mod || !mod.S3Client) {
      throw new Error('Missing @aws-sdk/client-s3');
    }
    const { S3Client } = mod;
    this.s3 = new S3Client({
      region: 'auto',
      endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: R2_ACCESS_KEY_ID!,
        secretAccessKey: R2_SECRET_ACCESS_KEY!,
      },
      maxAttempts: 3,
    });
    return this.s3;
  }

  async uploadFile(localPath: string, remoteKey: string): Promise<string> {
    if (this.dryRun) {
      const stat = await fs.stat(localPath);
      console.log('R2 dry-run upload', remoteKey, stat.size);
    } else {
      const client = await this.getClient();
      const { PutObjectCommand } = await import('@aws-sdk/client-s3');
      for (let attempt = 0; attempt < 3; attempt++) {
        const stream = createReadStream(localPath);
        try {
          await client.send(
            new PutObjectCommand({
              Bucket: this.bucket,
              Key: remoteKey,
              Body: stream,
              ACL: 'public-read',
            }),
          );
          break;
        } catch (e) {
          stream.destroy();
          if (attempt === 2) throw e;
          console.warn('R2 upload retry', remoteKey, e);
        }
      }
    }
    return `${this.baseUrl.replace(/\/$/, '')}/${remoteKey.replace(/^\//, '')}`;
  }

  async uploadDir(dir: string, prefix: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const localPath = path.join(dir, entry.name);
      const remoteKey = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await this.uploadDir(localPath, remoteKey);
      } else {
        await this.uploadFile(localPath, remoteKey);
      }
    }
  }
}
