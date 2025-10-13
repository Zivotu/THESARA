import path from 'node:path';
import { getConfig } from '../config.js';

const { BUNDLE_STORAGE_PATH } = getConfig();

export function buildDir(id: string): string {
  return path.join(BUNDLE_STORAGE_PATH, 'builds', id);
}

export function buildLlmPath(id: string): string {
  return path.join(buildDir(id), 'llm.json');
}
