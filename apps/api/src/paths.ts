import path from 'node:path';
import { BUNDLE_DIR, PREVIEW_DIR } from './config.js';

export const BUNDLE_ROOT = BUNDLE_DIR;
export const PREVIEW_ROOT = PREVIEW_DIR;

export const getBuildDir = (id: string) =>
  path.join(BUNDLE_ROOT, 'builds', id);

export function getBundleDir(id: string) {
  return path.join(BUNDLE_ROOT, 'builds', id, 'bundle');
}

export function getLlmReportPath(id: string) {
  return path.join(getBuildDir(id), 'llm.json');
}
