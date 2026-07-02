import express from 'express';
import { pipeline, env } from '@xenova/transformers';

// Use the model baked into the Docker image; never hit the network at runtime.
// Falls back to default (network) when running locally without the baked image.
if (process.env.RAILWAY_ENVIRONMENT) {
  env.cacheDir = '/app/models';
  env.allowRemoteModels = false;
}

const app = express();
app.use(express.json({ limit: '10mb' }));

let embedder = null;

// Server-side cache for embeddings
const embeddingCache = new Map();
const MAX_CACHE_SIZE = 5000;

// Performance tracking
let requestCount = 0;
let cacheHits = 0;
let batchRequestNumber = 0;

// Cache helper
function getCacheKey(text) {
  return text.slice(0, 300); // Use first 300 chars as key
}

function cacheGet(key) {
  if (embeddingCache.has(key)) {
    cacheHits++;
    return embeddingCache.get(key);
  }
  return null;
}

function cacheSet(key, value) {
  if (embeddingCache.size >= MAX_CACHE_SIZE) {
    // Remove oldest entry (first key)
    const firstKey = embeddingCache.keys().next().value;
    if (firstKey) {
      embeddingCache.delete(firstKey);
    }
  }
  embeddingCache.set(key, value);
}

// Load the model on startup
async function loadModel() {
  console.log('🔄 Loading BIG embedding model (bge-large-en-v1.5 - 1024 dims)...');
  console.log('   This may take a few minutes on first run (downloading ~1.3GB model)...');
  const start = Date.now();

  // Use bge-large-en-v1.5 for 1024 dimensions
  embedder = await pipeline('feature-extraction', 'Xenova/bge-large-en-v1.5');

  const elapsed = ((Date.now() - start) / 1000).toFixed(2);
  console.log(`✅ BIG model loaded in ${elapsed}s`);
  console.log(`   Model: bge-large-en-v1.5`);
  console.log(`   Dimensions: 1024 (2.67x larger than standard 384)`);
}

// Generate embedding with caching
async function generateEmbedding(text) {
  const cacheKey = getCacheKey(text);

  // Check cache first
  const cached = cacheGet(cacheKey);
  if (cached) {
    return cached;
  }

  // Generate new embedding
  const output = await embedder(text, { pooling: 'mean', normalize: true });
  const embedding = Array.from(output.data);

  // Cache it
  cacheSet(cacheKey, embedding);

  return embedding;
}

// Health check
app.get('/health', (_req, res) => {
  const response = {
    status: 'ok',
    model: 'bge-large-en-v1.5',
    ready: embedder !== null,
    dimensions: 1024,
    stats: {
      requests: requestCount,
      cacheHits,
      cacheSize: embeddingCache.size,
      hitRate: requestCount > 0 ? (cacheHits / requestCount * 100).toFixed(1) + '%' : '0%'
    }
  };

  console.log(`💓 Health check: ${embedder ? 'READY' : 'NOT READY'} (requests: ${requestCount}, cache: ${embeddingCache.size}/${MAX_CACHE_SIZE}, hit rate: ${response.stats.hitRate})`);

  res.json(response);
});

// Single text embedding
app.post('/embed', async (req, res) => {
  const start = Date.now();

  try {
    if (!embedder) {
      console.warn('⚠️ Embed request but model not loaded yet');
      return res.status(503).json({ error: 'Model not loaded yet' });
    }

    const { text } = req.body;

    if (!text) {
      console.warn('⚠️ Embed request missing text field');
      return res.status(400).json({ error: 'Missing "text" field' });
    }

    const textPreview = text.slice(0, 80).replace(/\n/g, ' ');
    console.log(`📥 Embed request: "${textPreview}..." (${text.length} chars)`);

    requestCount++;
    const cacheKey = getCacheKey(text);
    const wasCached = embeddingCache.has(cacheKey);

    const embedding = await generateEmbedding(text);

    const elapsed = Date.now() - start;
    const cacheStatus = wasCached ? '💾 CACHE HIT' : '🔄 GENERATED';
    console.log(`✅ ${cacheStatus}: ${elapsed}ms (${embedding.length} dims, cache: ${embeddingCache.size}/${MAX_CACHE_SIZE})`);

    const response = {
      embedding,
      dimensions: embedding.length
    };

    res.json(response);
    console.log(`📤 Response sent (${JSON.stringify(response).length} bytes)`);

  } catch (error) {
    console.error('❌ Embedding error:', error.message);
    console.error('   Stack:', error.stack);
    res.status(500).json({ error: error.message });
  }
});

// Batch embeddings with parallel processing + caching
app.post('/embed/batch', async (req, res) => {
  const start = Date.now();

  try {
    if (!embedder) {
      console.warn('⚠️ Batch embed request but model not loaded yet');
      return res.status(503).json({ error: 'Model not loaded yet' });
    }

    const { texts } = req.body;

    if (!Array.isArray(texts)) {
      console.warn('⚠️ Batch embed request missing texts array');
      return res.status(400).json({ error: 'Missing "texts" array' });
    }

    batchRequestNumber++;
    console.log('─'.repeat(60));
    console.log(`📥 BIG-EMBEDDER Batch #${batchRequestNumber}: ${texts.length} texts to embed (1024 dims)`);
    console.log(`   Source: ${req.ip || 'unknown'} | Time: ${new Date().toLocaleTimeString()}`);

    // Check how many are cached
    const cacheStatus = texts.map(text => embeddingCache.has(getCacheKey(text)));
    const cachedCount = cacheStatus.filter(Boolean).length;
    const newCount = texts.length - cachedCount;

    if (cachedCount > 0) {
      console.log(`   💾 ${cachedCount} cached, 🔄 ${newCount} to generate`);
    }

    requestCount += texts.length;

    // Process all in parallel with caching and progress tracking
    let completed = 0;
    const total = texts.length;

    const embeddings = await Promise.all(
      texts.map(async (text, i) => {
        const result = await generateEmbedding(text);
        completed++;

        // Log progress every 10% or every 50 items (whichever is smaller)
        const progressInterval = Math.min(50, Math.max(1, Math.floor(total / 10)));
        if (completed % progressInterval === 0 || completed === total) {
          const pct = ((completed / total) * 100).toFixed(0);
          const bar = '█'.repeat(Math.floor(completed / total * 20)) + '░'.repeat(20 - Math.floor(completed / total * 20));
          console.log(`   [${bar}] ${completed}/${total} (${pct}%)`);
        }

        return result;
      })
    );

    const elapsed = Date.now() - start;
    const avgTime = (elapsed / texts.length).toFixed(1);
    const throughput = (texts.length / (elapsed / 1000)).toFixed(0);

    console.log(`✅ BIG-EMBEDDER Batch #${batchRequestNumber} complete:`);
    console.log(`   ⏱️  ${elapsed}ms total (avg ${avgTime}ms/item)`);
    console.log(`   🚀 Throughput: ${throughput} embeddings/sec`);
    console.log(`   💾 Cache: ${embeddingCache.size}/${MAX_CACHE_SIZE} entries`);
    console.log(`   📊 Hit rate: ${requestCount > 0 ? (cacheHits / requestCount * 100).toFixed(1) : '0'}%`);

    const response = {
      embeddings,
      count: embeddings.length,
      dimensions: embeddings[0]?.length || 0
    };

    res.json(response);
    const responseSize = (JSON.stringify(response).length / 1024).toFixed(1);
    console.log(`📤 Response sent: ${responseSize}KB`);
    console.log('─'.repeat(60));

  } catch (error) {
    console.error('❌ Batch embedding error:', error.message);
    console.error('   Stack:', error.stack);
    res.status(500).json({ error: error.message });
  }
});

// Clear cache endpoint (optional - for debugging)
app.post('/cache/clear', (_req, res) => {
  const prevSize = embeddingCache.size;
  embeddingCache.clear();
  cacheHits = 0;
  requestCount = 0;
  console.log(`🧹 Cache cleared (removed ${prevSize} entries, reset stats)`);
  res.json({ status: 'cache cleared', entriesRemoved: prevSize });
});

const PORT = process.env.PORT || 3001; // Different port than regular embedder
const HOST = process.env.HOST || (process.env.RAILWAY_ENVIRONMENT ? '0.0.0.0' : 'localhost');

// Start server FIRST (so Railway healthcheck can connect), then load model
app.listen(PORT, HOST, () => {
  console.log('='.repeat(60));
  console.log(`🚀 BIG EMBEDDER service listening on port ${PORT}`);
  console.log(`📍 Endpoints:`);
  console.log(`   GET  /health         - Health check with stats`);
  console.log(`   POST /embed          - Single text embedding`);
  console.log(`   POST /embed/batch    - Batch embeddings`);
  console.log(`   POST /cache/clear    - Clear cache (debug)`);
  console.log('='.repeat(60));
  console.log(`⏳ Server up, now loading model in background...`);

  // Load model in background after server starts
  loadModel().then(() => {
    console.log('='.repeat(60));
    console.log(`✅ BIG EMBEDDER fully ready!`);
    console.log(`📊 Model: bge-large-en-v1.5 (1024 dimensions)`);
    console.log(`💾 Cache: ${MAX_CACHE_SIZE} entries max`);
    console.log(`🔗 Ready for high-dimensional embeddings!`);
    console.log(`⚡ 2.67x more dimensional space than standard embedder`);
    console.log('='.repeat(60));
  }).catch(err => {
    console.error('❌ Failed to load BIG model:', err);
    console.error('   Stack:', err.stack);
    process.exit(1);
  });
});
