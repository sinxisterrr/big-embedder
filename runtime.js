import { createHash } from 'node:crypto';

export function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

export function embeddingCacheKey(text) {
  return createHash('sha256').update(text).digest('base64url');
}

export class LruEmbeddingCache {
  constructor(maxSize = 1000) {
    this.maxSize = Math.max(0, maxSize);
    this.values = new Map();
  }

  get size() {
    return this.values.size;
  }

  get(text) {
    const key = embeddingCacheKey(text);
    const value = this.values.get(key);
    if (!value) return undefined;
    this.values.delete(key);
    this.values.set(key, value);
    return value;
  }

  has(text) {
    return this.values.has(embeddingCacheKey(text));
  }

  set(text, embedding) {
    if (this.maxSize === 0) return;
    const key = embeddingCacheKey(text);
    this.values.delete(key);
    this.values.set(key, embedding);
    while (this.values.size > this.maxSize) {
      const oldest = this.values.keys().next().value;
      if (!oldest) break;
      this.values.delete(oldest);
    }
  }

  clear() {
    const removed = this.values.size;
    this.values.clear();
    return removed;
  }
}

export class QueueFullError extends Error {
  constructor(maxDepth) {
    super(`Embedding queue is full (${maxDepth} pending)`);
    this.name = 'QueueFullError';
    this.statusCode = 503;
  }
}

export class SerialInferenceQueue {
  constructor(maxDepth = 128) {
    this.maxDepth = Math.max(1, maxDepth);
    this.tail = Promise.resolve();
    this.pending = 0;
    this.activeSince = 0;
    this.activeLabel = '';
  }

  get activeAgeMs() {
    return this.activeSince ? Date.now() - this.activeSince : 0;
  }

  run(label, task) {
    if (this.pending >= this.maxDepth) {
      return Promise.reject(new QueueFullError(this.maxDepth));
    }

    this.pending++;
    const run = this.tail.then(async () => {
      this.activeSince = Date.now();
      this.activeLabel = label;
      try {
        return await task();
      } finally {
        this.activeSince = 0;
        this.activeLabel = '';
        this.pending--;
      }
    });
    this.tail = run.then(() => undefined, () => undefined);
    return run;
  }
}

export function withTimeout(work, timeoutMs, label) {
  let timer;
  return Promise.race([
    work,
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        const error = new Error(`${label} timed out after ${timeoutMs}ms`);
        error.statusCode = 504;
        reject(error);
      }, timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}

export function validateText(value, maxChars) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    const error = new Error('Missing non-empty "text" field');
    error.statusCode = 400;
    throw error;
  }
  if (value.length > maxChars) {
    const error = new Error(`Text exceeds ${maxChars} character limit`);
    error.statusCode = 413;
    throw error;
  }
  return value;
}
