import express from 'express';
import { pipeline, env } from '@xenova/transformers';
import {
  LruEmbeddingCache,
  SerialInferenceQueue,
  positiveInteger,
  validateText,
  withTimeout,
} from './runtime.js';

if (process.env.RAILWAY_ENVIRONMENT || process.env.OFFLINE_MODE === 'true') {
  env.cacheDir = process.env.MODEL_CACHE_PATH || '/app/models';
  env.allowRemoteModels = false;
}

const PORT = positiveInteger(process.env.PORT, 3001);
const HOST = process.env.HOST || '0.0.0.0';
const MAX_CACHE_SIZE = positiveInteger(process.env.EMBEDDING_CACHE_SIZE, 1000);
const MAX_BATCH_SIZE = positiveInteger(process.env.MAX_BATCH_SIZE, 128);
const MAX_TEXT_CHARS = positiveInteger(process.env.MAX_TEXT_CHARS, 50_000);
const MAX_QUEUE_DEPTH = positiveInteger(process.env.MAX_QUEUE_DEPTH, 128);
const REQUEST_TIMEOUT_MS = positiveInteger(process.env.REQUEST_TIMEOUT_MS, 45_000);
const INFERENCE_HARD_TIMEOUT_MS = positiveInteger(process.env.INFERENCE_HARD_TIMEOUT_MS, 120_000);
const MODEL_LOAD_TIMEOUT_MS = positiveInteger(process.env.MODEL_LOAD_TIMEOUT_MS, 300_000);

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || '2mb' }));

let embedder = null;
let modelState = 'loading';
let modelError = '';
let requestCount = 0;
let cacheHits = 0;
let batchRequestNumber = 0;

const embeddingCache = new LruEmbeddingCache(MAX_CACHE_SIZE);
const inferenceQueue = new SerialInferenceQueue(MAX_QUEUE_DEPTH);

function healthSnapshot() {
  const activeAgeMs = inferenceQueue.activeAgeMs;
  const stalled = activeAgeMs > INFERENCE_HARD_TIMEOUT_MS;
  return {
    status: modelState === 'ready' && !stalled ? 'ok' : 'unavailable',
    ready: modelState === 'ready' && !stalled,
    modelState,
    modelError: modelError || undefined,
    model: 'bge-large-en-v1.5',
    dimensions: 1024,
    queue: {
      pending: inferenceQueue.pending,
      activeAgeMs,
      activeLabel: inferenceQueue.activeLabel || undefined,
      maxDepth: MAX_QUEUE_DEPTH,
    },
    stats: {
      requests: requestCount,
      cacheHits,
      cacheSize: embeddingCache.size,
      cacheLimit: MAX_CACHE_SIZE,
      hitRate: requestCount > 0 ? `${(cacheHits / requestCount * 100).toFixed(1)}%` : '0%',
      rssMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
    },
  };
}

async function loadModel() {
  console.log('🔄 Loading bge-large-en-v1.5 (1024 dimensions)...');
  const startedAt = Date.now();
  try {
    embedder = await withTimeout(
      pipeline('feature-extraction', 'Xenova/bge-large-en-v1.5'),
      MODEL_LOAD_TIMEOUT_MS,
      'Model load',
    );
    modelState = 'ready';
    console.log(`✅ Model ready in ${((Date.now() - startedAt) / 1000).toFixed(2)}s`);
  } catch (error) {
    modelState = 'failed';
    modelError = error instanceof Error ? error.message : String(error);
    console.error(`❌ Model load failed: ${modelError}`);
    setTimeout(() => process.exit(1), 100).unref();
  }
}

async function generateEmbedding(text) {
  const cached = embeddingCache.get(text);
  if (cached) {
    cacheHits++;
    return { embedding: cached, cached: true };
  }

  const embedding = await inferenceQueue.run(`text:${text.length}`, async () => {
    const output = await embedder(text, { pooling: 'mean', normalize: true });
    const values = Array.from(output.data);
    if (values.length !== 1024 || values.some(value => !Number.isFinite(value))) {
      throw new Error(`Model returned an invalid embedding (${values.length} dimensions)`);
    }
    return values;
  });
  embeddingCache.set(text, embedding);
  return { embedding, cached: false };
}

function requireReady(res) {
  if (modelState === 'ready' && embedder) return true;
  res.status(503).json({ error: 'Embedding model is not ready', modelState, modelError: modelError || undefined });
  return false;
}

function sendError(res, error) {
  const status = Number(error?.statusCode) || 500;
  const message = error instanceof Error ? error.message : String(error);
  if (status >= 500) console.error(`❌ Embedding request failed: ${message}`);
  res.status(status).json({ error: message });
}

app.get('/live', (_req, res) => res.json({ status: 'alive' }));

app.get('/health', (_req, res) => {
  const snapshot = healthSnapshot();
  res.status(snapshot.ready ? 200 : 503).json(snapshot);
});

app.post('/embed', async (req, res) => {
  if (!requireReady(res)) return;
  const startedAt = Date.now();
  try {
    const text = validateText(req.body?.text, MAX_TEXT_CHARS);
    requestCount++;
    const result = await withTimeout(generateEmbedding(text), REQUEST_TIMEOUT_MS, 'Embedding request');
    res.json({ embedding: result.embedding, dimensions: result.embedding.length });
    console.log(`✅ ${result.cached ? 'CACHE' : 'MODEL'} ${Date.now() - startedAt}ms (${text.length} chars, queue=${inferenceQueue.pending}, rss=${healthSnapshot().stats.rssMb}MB)`);
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/embed/batch', async (req, res) => {
  if (!requireReady(res)) return;
  const startedAt = Date.now();
  try {
    if (!Array.isArray(req.body?.texts) || req.body.texts.length === 0) {
      const error = new Error('Missing non-empty "texts" array');
      error.statusCode = 400;
      throw error;
    }
    if (req.body.texts.length > MAX_BATCH_SIZE) {
      const error = new Error(`Batch exceeds ${MAX_BATCH_SIZE} item limit`);
      error.statusCode = 413;
      throw error;
    }

    const texts = req.body.texts.map(text => validateText(text, MAX_TEXT_CHARS));
    const requestNumber = ++batchRequestNumber;
    requestCount += texts.length;
    let cachedCount = 0;
    const embeddings = [];

    // Intentionally sequential. ONNX inference is already internally threaded;
    // Promise.all here multiplied model work and caused container memory spikes.
    for (const text of texts) {
      const result = await withTimeout(generateEmbedding(text), REQUEST_TIMEOUT_MS, 'Batch embedding item');
      if (result.cached) cachedCount++;
      embeddings.push(result.embedding);
    }

    res.json({ embeddings, count: embeddings.length, dimensions: embeddings[0]?.length || 0 });
    console.log(`✅ Batch #${requestNumber}: ${embeddings.length} items (${cachedCount} cached) in ${Date.now() - startedAt}ms, rss=${healthSnapshot().stats.rssMb}MB`);
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/cache/clear', (_req, res) => {
  const entriesRemoved = embeddingCache.clear();
  cacheHits = 0;
  requestCount = 0;
  res.json({ status: 'cache cleared', entriesRemoved });
});

app.use((error, _req, res, _next) => {
  if (error?.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request body is too large' });
  }
  sendError(res, error);
});

const watchdog = setInterval(() => {
  if (inferenceQueue.activeAgeMs > INFERENCE_HARD_TIMEOUT_MS) {
    console.error(`❌ Inference watchdog: "${inferenceQueue.activeLabel}" has been active for ${inferenceQueue.activeAgeMs}ms; exiting for container recovery`);
    process.exit(1);
  }
}, 10_000);
watchdog.unref();

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    console.log(`${signal} received; shutting down`);
    process.exit(0);
  });
}

process.on('uncaughtException', error => {
  console.error('❌ Uncaught exception:', error);
  process.exit(1);
});
process.on('unhandledRejection', error => {
  console.error('❌ Unhandled rejection:', error);
  process.exit(1);
});

app.listen(PORT, HOST, () => {
  console.log(`🚀 BIG EMBEDDER listening on http://${HOST}:${PORT}`);
  console.log(`🧯 Limits: batch=${MAX_BATCH_SIZE}, queue=${MAX_QUEUE_DEPTH}, cache=${MAX_CACHE_SIZE}, request=${REQUEST_TIMEOUT_MS}ms, watchdog=${INFERENCE_HARD_TIMEOUT_MS}ms`);
  void loadModel();
});
