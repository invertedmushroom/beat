import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';

const { createCamera } = await import(pathToFileURL(join(process.env.EVAL_WORKSPACE, 'src/camera.ts')));

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function stream() {
  const tracks = [{ stops: 0, stop() { this.stops += 1; } }, { stops: 0, stop() { this.stops += 1; } }];
  return { tracks, getTracks: () => tracks };
}

function setup() {
  const pending = [];
  const attached = [];
  const messages = [];
  let preview;
  const port = {
    request() { const item = deferred(); pending.push(item); return item.promise; },
    async attach(value) { attached.push(value); preview = value; },
    detach() { preview = undefined; },
  };
  const camera = createCamera(port, message => messages.push(message));
  return { camera, port, pending, attached, messages, get preview() { return preview; } };
}

function assertReleased(value) {
  assert.ok(value.tracks.every(track => track.stops > 0), 'each acquired track must be stopped');
}

test('a permission grant arriving after disposal releases tracks without attachment', async () => {
  const fixture = setup();
  const starting = fixture.camera.start();
  fixture.camera.dispose();
  const acquired = stream();
  fixture.pending[0].resolve(acquired);
  await starting;
  assertReleased(acquired);
  assert.equal(fixture.attached.length, 0);
  assert.equal(fixture.preview, undefined);
});

test('stop and restart keep a late old request away from the new preview', async () => {
  const fixture = setup();
  const oldStart = fixture.camera.start();
  fixture.camera.stop();
  const newStart = fixture.camera.start();
  const active = stream();
  fixture.pending[1].resolve(active);
  await newStart;
  const obsolete = stream();
  fixture.pending[0].resolve(obsolete);
  await oldStart;
  assertReleased(obsolete);
  assert.equal(fixture.preview, active);
  assert.ok(active.tracks.every(track => track.stops === 0));
  fixture.camera.dispose();
  fixture.camera.dispose();
  assertReleased(active);
});

test('an obsolete request rejection does not fail a replacement session', async () => {
  const fixture = setup();
  const oldStart = fixture.camera.start();
  fixture.camera.stop();
  const newStart = fixture.camera.start();
  const active = stream();
  fixture.pending[1].resolve(active);
  await newStart;
  fixture.pending[0].reject(new Error('old permission request denied'));
  await oldStart;
  assert.equal(fixture.preview, active);
  assert.equal(fixture.messages.length, 0);
  fixture.camera.dispose();
});

test('preview failure after acquisition releases tracks and reports the current error', async () => {
  const fixture = setup();
  fixture.port.attach = async value => { fixture.attached.push(value); throw new Error('play failed'); };
  const starting = fixture.camera.start();
  const acquired = stream();
  fixture.pending[0].resolve(acquired);
  await starting;
  assertReleased(acquired);
  assert.ok(fixture.messages.length > 0);
  fixture.camera.dispose();
  assertReleased(acquired);
});

test('disposal while preview startup is pending leaves no active resources', async () => {
  const fixture = setup();
  const previewReady = deferred();
  const attach = fixture.port.attach;
  fixture.port.attach = async value => { await attach(value); await previewReady.promise; };
  const starting = fixture.camera.start();
  const acquired = stream();
  fixture.pending[0].resolve(acquired);
  await new Promise(resolve => setImmediate(resolve));
  fixture.camera.dispose();
  previewReady.resolve();
  await starting;
  assertReleased(acquired);
  assert.equal(fixture.preview, undefined);
});

test('a disposed panel does not acquire another camera', async () => {
  const fixture = setup();
  fixture.camera.dispose();
  const starting = fixture.camera.start();
  for (const request of fixture.pending) request.resolve(stream());
  await starting;
  assert.equal(fixture.pending.length, 0);
  assert.equal(fixture.attached.length, 0);
});
