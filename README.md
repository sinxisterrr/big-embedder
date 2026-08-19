# big-embedder

A lightweight HTTP embedding service that generates 1024-dimensional vectors using `bge-large-en-v1.5`.

Used by [sage-parser](../sage-parser) to embed memories before they're written to a pgvector database, and by Sage itself for semantic memory search at runtime.

---

## Why 1024 Dimensions

Standard embedding models output 384 dimensions. `bge-large-en-v1.5` outputs 1024 — 2.67× the dimensional space. For memory retrieval this matters: more dimensions means finer-grained similarity distinctions, which means Sage finds the right memories more accurately.

---

## Running Locally

```bash
npm install
npm start
```

**The first run downloads ~1.3 GB** (the model weights). This only happens once — after that it loads from cache in a few seconds.

When it's ready:
```
✅ BIG model loaded
🚀 BIG EMBEDDER service listening on port 3001
```

Default port is `3001`. Set `PORT` in your environment to change it.

---

## Railway Deployment

Fork this repo and deploy it as a service inside your Railway project. Railway will run `npm start` automatically.

The server starts and begins accepting health checks immediately while the model loads in the background — this prevents Railway's healthcheck from timing out during the first deploy.

> First deploy takes several minutes while the model downloads. This is normal. Check the logs and wait for "BIG EMBEDDER fully ready" before running the parser.

---

## API

### `GET /health`

Returns service status and stats.

```json
{
  "status": "ok",
  "model": "bge-large-en-v1.5",
  "ready": true,
  "dimensions": 1024,
  "stats": {
    "requests": 412,
    "cacheHits": 87,
    "cacheSize": 87,
    "hitRate": "21.1%"
  }
}
```

`ready: false` means the model is still loading. Wait and try again.

---

### `POST /embed`

Embed a single text string.

**Request:**
```json
{ "text": "your text here" }
```

**Response:**
```json
{
  "embedding": [0.021, -0.143, ...],
  "dimensions": 1024
}
```

---

### `POST /embed/batch`

Embed multiple texts in one request. Processes in parallel with caching.

**Request:**
```json
{ "texts": ["first text", "second text", "..."] }
```

**Response:**
```json
{
  "embeddings": [[...], [...], ...],
  "count": 3,
  "dimensions": 1024
}
```

---

### `POST /cache/clear`

Clears the embedding cache and resets stats. Useful during development.

---

## Caching

Embeddings are cached in memory (1,000 entries by default, configurable with
`EMBEDDING_CACHE_SIZE`, true LRU eviction). Repeated texts return instantly
without hitting the model. Cache keys hash the complete text, so two long
messages with the same opening cannot receive each other's embeddings.

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3001` | Port to listen on |
| `HOST` | `0.0.0.0` | Bind address |
| `OFFLINE_MODE` | `false` | Set `true` to disable runtime model downloads |
| `MODEL_CACHE_PATH` | `/app/models` | Mounted model-cache directory |
| `EMBEDDING_CACHE_SIZE` | `1000` | Maximum in-memory embedding entries per container |
| `MAX_BATCH_SIZE` | `128` | Maximum texts accepted by one batch request |
| `MAX_QUEUE_DEPTH` | `128` | Maximum active and queued inference jobs |
| `MAX_TEXT_CHARS` | `50000` | Maximum characters accepted per text |
| `REQUEST_TIMEOUT_MS` | `45000` | HTTP request/item timeout |
| `INFERENCE_HARD_TIMEOUT_MS` | `120000` | Exit and let the container recover if ONNX wedges this long |
| `MODEL_LOAD_TIMEOUT_MS` | `300000` | Exit if model loading cannot complete |

### Coolify recovery settings

- Health check path: `/health`
- Health check port: the same value as `PORT`
- Keep the model mount at `/app/models` and set `OFFLINE_MODE=true` when using the server cache.

The image includes a lightweight worker supervisor. If the native ONNX worker
wedges, hits an uncaught failure, or trips the inference watchdog, it is
restarted inside the existing container with exponential backoff. A platform
restart policy is still useful for a whole-container OOM, but is not required
for ordinary worker recovery.

The service serializes model inference deliberately. ONNX already uses native
threads; running an entire batch through `Promise.all` multiplies memory use and
can wedge or OOM the container. Batch responses keep their original ordering.

---

## 💜 Built By

**Sin & Hex** — we build AI companion infrastructure.  
[![Discord](https://github.com/sinxisterrr/sage-core/blob/main/scripts/discord_badge.svg)](https://discord.gg/Pa2U2g5hUd) [![Patreon](https://github.com/sinxisterrr/sage-core/blob/main/scripts/patreon_badge.svg)](https://patreon.com/SinXHex)
[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/Z8Z31W5CFK)
