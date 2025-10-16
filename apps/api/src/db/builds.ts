import { db } from '../db.js';
import { readIndex, readArtifact, type ArtifactIndex } from '../utils/artifacts.js';

export interface StoredBuild {
  id: string;
  artifacts: ArtifactIndex;
  llmReport?: any;
  createdAt: number;
}

const COLLECTION = 'build_records';
const AUDIT_COLLECTION = 'build_audit';

export async function saveBuildData(buildId: string): Promise<void> {
  try {
    const artifacts = await readIndex(buildId);
    let llmReport: any | undefined;
    try {
      const txt = await readArtifact(buildId, 'llm.json');
      llmReport = JSON.parse(txt);
    } catch {
      llmReport = undefined;
    }
    const data: any = {
      id: buildId,
      artifacts,
      createdAt: Date.now(),
    };
    if (llmReport !== undefined) data.llmReport = llmReport;
    await db.collection(COLLECTION).doc(buildId).set(data);
  } catch (err) {
    console.error('saveBuildData failed', err);
  }
}

export async function getBuildData(buildId: string): Promise<StoredBuild | undefined> {
  try {
    const snap = await db.collection(COLLECTION).doc(buildId).get();
    if (!snap.exists) return undefined;
    const data = snap.data() as any;
    return {
      id: buildId,
      artifacts: (data.artifacts || { artifacts: {}, createdAt: '' }) as ArtifactIndex,
      llmReport: data.llmReport,
      createdAt:
        typeof data.createdAt?.toMillis === 'function'
          ? data.createdAt.toMillis()
          : data.createdAt,
    };
  } catch (err) {
    console.error('getBuildData failed', err);
    return undefined;
  }
}

export async function logBuildStart(buildId: string, userId: string): Promise<void> {
  try {
    await db.collection(AUDIT_COLLECTION).doc(buildId).set({
      startedBy: userId,
      startedAt: Date.now(),
    });
  } catch (err) {
    console.error('logBuildStart failed', err);
  }
}
