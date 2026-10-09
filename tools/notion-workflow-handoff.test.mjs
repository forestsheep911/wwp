import test from 'node:test';
import assert from 'node:assert/strict';
import { applySet, claimCandidates } from './notion-workflow-handoff.mjs';

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

test('visibility release leaves an unset legacy workflow status unchanged', async () => {
  const page = {
    id: '3ca20ac1-2f0a-8102-ac4a-e0b46fc423ce',
    properties: {
      'Workflow Status': { type: 'select', select: null },
      'Workflow Note': { type: 'rich_text', rich_text: [] },
      'Hide from Website': { type: 'checkbox', checkbox: true }
    }
  };
  const updates = [];
  let current = page;
  const notion = { pages: {
    update: async ({ page_id, properties }) => {
      updates.push({ page_id, properties });
      current = { ...current, properties: { ...current.properties, ...properties } };
    },
    retrieve: async () => current
  } };

  const result = await applySet(notion, page, {
    release_visibility: true,
    hide_from_website: false,
    apply: true
  });

  assert.equal(result.applied, true);
  assert.equal(result.update.currentStatus, '');
  assert.equal(result.update.nextStatus, '');
  assert.deepEqual(updates[0].properties, { 'Hide from Website': { checkbox: false } });
  assert.equal(current.properties['Workflow Status'].select, null);
});
