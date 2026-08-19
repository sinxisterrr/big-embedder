import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LruEmbeddingCache,
  SerialInferenceQueue,
  embeddingCacheKey,
  validateText,
  withTimeout,
} from '../runtime.js';

test('cache keys use the complete text instead of a collision-prone prefix', () => {
  const prefix = 'x'.repeat(300);
  assert.notEqual(embeddingCacheKey(`${prefix}a`), embeddingCacheKey(`${prefix}b`));
});

test('LRU cache evicts the least recently used entry', () => {
  const cache = new LruEmbeddingCache(2);
  cache.set('a', [1]);
  cache.set('b', [2]);
  assert.deepEqual(cache.get('a'), [1]);
  cache.set('c', [3]);
  assert.equal(cache.get('b'), undefined);
  assert.deepEqual(cache.get('a'), [1]);
  assert.deepEqual(cache.get('c'), [3]);
});

test('inference work is serialized and queue depth is bounded', async () => {
  const queue = new SerialInferenceQueue(2);
  let active = 0;
  let maxActive = 0;
  let releaseFirst;
  const firstGate = new Promise(resolve => { releaseFirst = resolve; });

  const first = queue.run('first', async () => {
    active++;
    maxActive = Math.max(maxActive, active);
    await firstGate;
    active--;
    return 1;
  });
  const second = queue.run('second', async () => {
    active++;
    maxActive = Math.max(maxActive, active);
    active--;
    return 2;
  });
  await assert.rejects(() => queue.run('third', async () => 3), /queue is full/);
  releaseFirst();
  assert.deepEqual(await Promise.all([first, second]), [1, 2]);
  assert.equal(maxActive, 1);
});

test('timeouts and text limits fail explicitly', async () => {
  await assert.rejects(
    () => withTimeout(new Promise(() => {}), 10, 'test inference'),
    /timed out/,
  );
  assert.throws(() => validateText('', 10), /Missing non-empty/);
  assert.throws(() => validateText('too long', 3), /exceeds/);
  assert.equal(validateText('okay', 10), 'okay');
});
