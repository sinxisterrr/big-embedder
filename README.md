# Big Embedder Service

High-dimensional embedding service using `bge-large-en-v1.5` (1024 dimensions) via Xenova Transformers.js

## Features

- **1024-dimensional embeddings** (2.67x more dimensional space than standard 384-dim models)
- **Server-side caching** (5000 entries max, LRU eviction)
- **Batch processing** with parallel execution and progress tracking
- **Health monitoring** with stats (cache hit rate, throughput, etc.)

## API Endpoints

### `GET /health`
Health check with model info and statistics
```json
{
  "status": "ok",
  "model": "bge-large-en-v1.5",
  "ready": true,
  "dimensions": 1024,
  "stats": {
    "requests": 150,
    "cacheHits": 45,
    "cacheSize": 150,
    "hitRate": "30.0%"
  }
}
```

### `POST /embed`
Embed a single text
```json
{
  "text": "Your text here"
}
```

Response:
```json
{
  "embedding": [0.123, -0.456, ...],
  "dimensions": 1024
}
```

### `POST /embed/batch`
Embed multiple texts in parallel
```json
{
  "texts": ["First text", "Second text", "Third text"]
}
```

Response:
```json
{
  "embeddings": [[...], [...], [...]],
  "count": 3,
  "dimensions": 1024
}
```

### `POST /cache/clear`
Clear the embedding cache (debug only)

## Railway Deployment

### Quick Start

1. **Push to GitHub**
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin <your-repo-url>
   git push -u origin main
   ```

2. **Deploy on Railway**
   - Go to [railway.app](https://railway.app)
   - Click "New Project" → "Deploy from GitHub repo"
   - Select your `big-embedder` repository
   - Railway will auto-detect Node.js and deploy

3. **Get your service URL**
   - Railway provides both:
     - **Public URL**: `https://big-embedder-production-xxxx.up.railway.app`
     - **Private URL**: `big-embedder.railway.internal` (for internal services)

4. **Configure your bot**
   - Set `EMBEDDING_SERVICE_URL` in your Discord bot to the private URL:
     ```
     EMBEDDING_SERVICE_URL=http://big-embedder.railway.internal:3000
     ```

### Resource Requirements

- **RAM**: ~1.5-2GB (model is 1.3GB)
- **CPU**: 1 vCPU minimum
- **Storage**: ~2GB for model cache
- **Estimated cost**: $10-15/month on Railway (beyond $5 hobby credit)

### Environment Variables

Railway auto-sets `PORT` - no manual config needed.

Optional variables:
- `PORT`: Service port (default: 3001, Railway overrides this)

### First Deployment

The first deployment will take 5-10 minutes because:
1. Railway builds the container
2. `npm install` downloads dependencies (~500MB)
3. First request downloads the model (~1.3GB)
4. Model loads into memory (~1-2 minutes)

**Health check timeout is set to 300s** to allow for model loading.

### Monitoring

Check logs in Railway dashboard:
- Look for `✅ BIG model loaded in Xs`
- Monitor cache hit rates and throughput
- Watch for memory usage (should stabilize ~1.5-2GB)

### Connecting Your Bot

Once deployed, update your Discord bot's embedding configuration:

**In ash-updated:**
1. Change `EMBEDDING_SERVICE_URL` to point to big-embedder
2. Update `EMBEDDING_DIMS` from 384 → 1024
3. Rebuild vector database with 1024-dim embeddings

**Or run both services:**
- Keep old embedder for existing 384-dim vectors
- Use big-embedder for new semantic search tasks

## Local Development

```bash
npm install
npm start
```

Service runs on `http://localhost:3001` by default.

Test it:
```bash
curl http://localhost:3001/health
```

## Model Info

- **Model**: `Xenova/bge-large-en-v1.5`
- **Dimensions**: 1024
- **Download size**: ~1.3GB
- **Memory usage**: ~1.5-2GB when loaded
- **Speed**: ~50-100 embeddings/sec (depends on hardware)

## Cache Behavior

- Cache uses first 300 chars as key
- LRU eviction when limit reached (5000 entries)
- Cache persists across requests (not across restarts)
- Cache stats available at `/health` endpoint
