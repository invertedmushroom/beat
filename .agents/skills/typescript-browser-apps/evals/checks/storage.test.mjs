import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';

const { createDraftStore, DRAFT_KEY } = await import(pathToFileURL(join(process.env.EVAL_WORKSPACE, 'src/drafts.ts')));

function setup(raw = null, failures = {}) {
  const values = new Map(raw === null ? [] : [[DRAFT_KEY, raw]]);
  const messages = [];
  let writes = 0;
  const storage = {
    getItem: key => {
      if (failures.read) throw new Error('storage unavailable');
      return values.get(key) ?? null;
    },
    setItem: (key, value) => {
      if (failures.write) throw new Error('quota exceeded');
      writes += 1;
      values.set(key, value);
    },
  };
  const store = createDraftStore(storage, message => messages.push(message));
  return { store, values, messages, get writes() { return writes; } };
}

test('new drafts and supported versions remain editable and survive reload', () => {
  for (const raw of [null, '{"version":2,"text":"current"}', '{"version":1,"content":"legacy"}']) {
    const fixture = setup(raw);
    const loaded = fixture.store.load();
    assert.equal(loaded.version, 2);
    assert.equal(loaded.text, raw === null ? '' : raw.includes('legacy') ? 'legacy' : 'current');
    assert.equal(fixture.store.save({ version: 2, text: 'edited' }), true);
    const restored = createDraftStore({ getItem: key => fixture.values.get(key) ?? null, setItem() {} }, () => {});
    assert.deepEqual(restored.load(), { version: 2, text: 'edited' });
    assert.equal(fixture.messages.length, 0);
  }
});

test('a newer schema survives the actual load-then-autosave path', () => {
  const raw = '{"version":3,"text":"future text","attachments":["recover-me"]}';
  const fixture = setup(raw);
  fixture.store.load();
  assert.equal(fixture.store.save({ version: 2, text: 'edited by older client' }), false);
  assert.equal(fixture.values.get(DRAFT_KEY), raw);
  assert.equal(fixture.writes, 0);
  assert.ok(fixture.messages.length > 0);
});

test('corrupt durable data remains recoverable after migration or decoding failure', () => {
  for (const raw of ['{"version":1,"content":42}', '{"version":2,"text":42}', '{broken']) {
    const fixture = setup(raw);
    fixture.store.load();
    assert.equal(fixture.store.save({ version: 2, text: 'autosave' }), false);
    assert.equal(fixture.values.get(DRAFT_KEY), raw);
    assert.equal(fixture.writes, 0);
    assert.ok(fixture.messages.length > 0);
  }
});

test('an unavailable read cannot be followed by an overwrite', () => {
  const raw = '{"version":2,"text":"saved before read failed"}';
  const fixture = setup(raw, { read: true });
  assert.doesNotThrow(() => fixture.store.load());
  assert.equal(fixture.store.save({ version: 2, text: 'autosave' }), false);
  assert.equal(fixture.values.get(DRAFT_KEY), raw);
  assert.ok(fixture.messages.length > 0);
});

test('a failed save reports failure without publishing an unsaved draft as saved', () => {
  const fixture = setup('{"version":2,"text":"saved"}', { write: true });
  fixture.store.load();
  assert.equal(fixture.store.save({ version: 2, text: 'unsaved' }), false);
  assert.deepEqual(fixture.store.current(), { version: 2, text: 'saved' });
  assert.equal(fixture.values.get(DRAFT_KEY), '{"version":2,"text":"saved"}');
  assert.ok(fixture.messages.length > 0);
});
