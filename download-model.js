// Run during Docker build to pre-download the model into the image.
// This prevents runtime network calls to Hugging Face.
import { pipeline, env } from '@xenova/transformers';

env.cacheDir = '/app/models';
env.allowRemoteModels = true;

console.log('📦 Pre-downloading bge-large-en-v1.5 into image...');
await pipeline('feature-extraction', 'Xenova/bge-large-en-v1.5');
console.log('✅ Model downloaded and cached at /app/models');
