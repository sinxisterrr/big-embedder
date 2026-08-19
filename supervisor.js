import { spawn } from 'node:child_process';

const MIN_RESTART_DELAY_MS = 1000;
const MAX_RESTART_DELAY_MS = 60_000;
const STABLE_RUN_MS = 5 * 60_000;

let child = null;
let stopping = false;
let failures = 0;

function restartDelay() {
  return Math.min(MAX_RESTART_DELAY_MS, MIN_RESTART_DELAY_MS * (2 ** Math.min(failures, 6)));
}

function startWorker() {
  const startedAt = Date.now();
  child = spawn(process.execPath, ['index.js'], {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  });

  child.once('exit', (code, signal) => {
    child = null;
    if (stopping) process.exit(code ?? 0);

    if (Date.now() - startedAt >= STABLE_RUN_MS) failures = 0;
    failures++;
    const delay = restartDelay();
    console.error(`🧯 Embedder worker exited (${signal || code}); restarting in ${delay}ms (failure ${failures})`);
    setTimeout(startWorker, delay);
  });

  child.once('error', error => {
    console.error('🧯 Could not start embedder worker:', error);
  });
}

function stop(signal) {
  if (stopping) return;
  stopping = true;
  if (!child) process.exit(0);
  child.kill(signal);
  setTimeout(() => child?.kill('SIGKILL'), 10_000).unref();
}

process.on('SIGTERM', () => stop('SIGTERM'));
process.on('SIGINT', () => stop('SIGINT'));

console.log('🧯 Embedder supervisor active');
startWorker();
