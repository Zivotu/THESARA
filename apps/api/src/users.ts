import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getConfig } from './config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PKG_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(PKG_ROOT, '../..');

const { DATABASE_URL } = getConfig();
const dbPath = DATABASE_URL;
const db = new Database(dbPath);

db.prepare(
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    address TEXT,
    city TEXT,
    postalCode TEXT,
    country TEXT,
    vatId TEXT
  )`
).run();

// Ensure new columns exist for existing databases
for (const col of ['address', 'city', 'postalCode', 'country', 'vatId']) {
  try {
    db.prepare(`ALTER TABLE users ADD COLUMN ${col} TEXT`).run();
  } catch (e) {
    // ignore if column already exists
  }
}

export class UserExistsError extends Error {
  constructor() {
    super('user_exists');
  }
}

export function createUser(
  email: string,
  passwordHash: string,
  address?: string,
  city?: string,
  postalCode?: string,
  country?: string,
  vatId?: string,
): void {
  try {
    db.prepare(
      'INSERT INTO users (id, email, password, address, city, postalCode, country, vatId) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(
      randomUUID(),
      email,
      passwordHash,
      address ?? null,
      city ?? null,
      postalCode ?? null,
      country ?? null,
      vatId ?? null,
    );
  } catch (err: any) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      throw new UserExistsError();
    }
    throw err;
  }
}
