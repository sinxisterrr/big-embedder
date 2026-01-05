# Big Embedder Service

High-dimensional embedding service using **bge-large-en-v1.5** (1024 dimensions).

## Why 1024 dimensions?

- **2.67x more dimensional space** than standard 384-dim embeddings
- Better semantic understanding and retrieval quality
- Sweet spot for local hardware (your RTX 3060 can handle it)
- Significantly better than 384, not as overkill as 1536+

## Hardware Requirements

- **VRAM**: ~1.3GB (easily fits in your 12GB 3060)
- **RAM**: ~2GB during operation
- **Storage**: ~1.3GB for model download

## Usage

```bash
npm install
npm start
```

Service runs on port **3001** (regular embedder uses 3000).

## Endpoints

- `GET /health` - Check if model is loaded
- `POST /embed` - Single text embedding
- `POST /embed/batch` - Batch embeddings (recommended)

## Performance

- First run: Downloads ~1.3GB model (one-time)
- Subsequent runs: Loads from cache (~30-60 seconds)
- Speed: Slightly slower than 384-dim model but still fast enough

## vs Standard Embedder

| Feature | Standard (384) | Big (1024) |
|---------|---------------|------------|
| Dimensions | 384 | 1024 |
| Model | all-MiniLM-L6-v2 | bge-large-en-v1.5 |
| VRAM | ~330MB | ~1.3GB |
| Quality | Good | Excellent |
| Speed | Faster | Slightly slower |
| Port | 3000 | 3001 |

## When to Use

- **Use Big Embedder** when quality matters more than speed
- **Use Standard Embedder** for quick tests or when speed matters

## For Parser

Set `EMBEDDER_URL=http://localhost:3001` to use big embeddings for parsing.
