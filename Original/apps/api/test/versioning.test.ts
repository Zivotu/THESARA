import assert from 'node:assert/strict';
import { computeNextVersion, ARCHIVE_TTL_MS } from '../src/lib/versioning.ts';
import type { AppRecord } from '../src/types.ts';

(async () => {
  const base: AppRecord = {
    id: '1',
    slug: 'app-1',
    buildId: 'b1',
    title: '',
    description: '',
    tags: [],
    visibility: 'public',
    accessMode: 'public',
    createdAt: 0,
    playUrl: '',
    version: 1,
  };
  const res1 = computeNextVersion(base, 1000);
  assert.equal(res1.version, 2);
  assert.equal(res1.archivedVersions.length, 1);
  assert.equal(res1.archivedVersions[0].buildId, 'b1');

  const oldArchive = { buildId: 'old', version: 0, archivedAt: 1000 - ARCHIVE_TTL_MS - 1 };
  const res2 = computeNextVersion({ ...base, buildId: 'b2', version: 2, archivedVersions: [oldArchive] }, 1000);
  assert.equal(res2.version, 3);
  assert.equal(res2.archivedVersions.length, 1);
  assert.equal(res2.archivedVersions[0].buildId, 'b2');
  console.log('versioning tests passed');
})();
