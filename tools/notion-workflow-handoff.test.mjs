import test from 'node:test';
import assert from 'node:assert/strict';
import { claimCandidates } from './notion-workflow-handoff.mjs';

test('explicit claim never queries or retrieves unrelated works', async () => {
  const id = '3ca20ac1-2f0a-8102-ac4a-e0b46fc423ce';
  const retrieved = [];
  const notion = { pages: { retrieve: async ({ page_id }) => {
    retrieved.push(page_id); return { id: page_id };
  } } };
  const rows = await claimCandidates(notion, 'unused', { page_id: [id, id], limit: 3 });
  assert.deepEqual(retrieved, [id]);
  assert.deepEqual(rows, [{ id }]);
});

test('invalid explicit claim fails before any database scan', async () => {
  await assert.rejects(claimCandidates({}, 'unused', { page_id: ['invalid'] }), /valid explicit page IDs/);
});
