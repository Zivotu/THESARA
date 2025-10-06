import path from 'node:path';
import { getConfig } from './config.js';

const config = getConfig();
export const BUNDLE_ROOT = config.BUNDLE_STORAGE_PATH;

export const PREVIEW_ROOT = config.PREVIEW_STORAGE_PATH;

export const getBuildDir = (id: string) =>
  path.join(BUNDLE_ROOT, 'builds', id);

export function getBundleDir(id: string) {
  return path.join(BUNDLE_ROOT, 'builds', id, 'bundle');
}

export function getLlmReportPath(id: string) {
  return path.join(getBuildDir(id), 'llm.json');
}
