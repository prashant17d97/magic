/**
 * Runs the whole fleet inside one container.
 *
 * The four deployables are separate processes for good reasons — a webhook flood must not stall
 * the console, and a worker must not compete with request handling — and none of those reasons
 * disappear here. What disappears is the isolation: this is a deployment shape for a proof of
 * concept, where one paid service beats four. Splitting them back out is a change to the
 * platform's configuration, not to any of this code.
 *
 * Only the console listens on a public interface. The API and the ingest endpoint bind to
 * loopback, so nothing outside the container can reach them and a platform that discovers a
 * service's port by scanning cannot pick the wrong one. The webhook endpoint is therefore not
 * reachable from Stripe in this shape.
 *
 * Any child exiting takes the container down. A supervisor that restarts one child would keep a
 * console serving happily while nothing reconciled behind it, and a reconciliation product that
 * looks healthy while it is not is worse than one that is plainly down.
 */
import { spawn } from 'node:child_process';

const PROCESSES = [
  { name: 'web', script: 'web/apps/web/server.js' },
  { name: 'api', script: 'apps/api/dist/main.js' },
  { name: 'ingest', script: 'apps/ingest/dist/main.js' },
  { name: 'worker', script: 'apps/worker/dist/main.js' },
];

const children = new Map();
let stopping = false;

function log(message) {
  process.stdout.write(`[fleet] ${message}\n`);
}

/** Signals every remaining child once, then leaves the exit to whoever called. */
function signalAll(signal) {
  for (const [name, child] of children) {
    if (child.exitCode === null && child.signalCode === null) {
      log(`sending ${signal} to ${name}`);
      child.kill(signal);
    }
  }
}

/**
 * A child that stops is terminal. The exit code is carried out of the container so the platform
 * sees a failed instance rather than a healthy one, and the siblings are given a chance to drain
 * first: the worker returns in-flight jobs to the queue on SIGTERM, which is the difference
 * between a restart that resumes and one that loses work.
 */
function onChildExit(name, code, signal) {
  if (stopping) return;
  stopping = true;

  log(`${name} exited (${signal ? `signal ${signal}` : `code ${code}`}); stopping the fleet`);
  signalAll('SIGTERM');

  const deadline = setTimeout(() => {
    log('drain timed out; forcing the remaining processes down');
    signalAll('SIGKILL');
  }, 15_000);
  deadline.unref();

  const settle = setInterval(() => {
    const running = [...children.values()].some((c) => c.exitCode === null && c.signalCode === null);
    if (running) return;
    clearInterval(settle);
    clearTimeout(deadline);
    process.exit(code === 0 || code === null ? 1 : code);
  }, 100);
}

for (const { name, script } of PROCESSES) {
  const child = spawn(process.execPath, [script], { stdio: 'inherit', env: process.env });
  children.set(name, child);
  child.on('exit', (code, signal) => onChildExit(name, code, signal));
  child.on('error', (error) => {
    log(`${name} failed to start: ${error.message}`);
    onChildExit(name, 1, null);
  });
  log(`started ${name} (pid ${child.pid})`);
}

/** A platform asking the container to stop is not a failure, so this path exits zero. */
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    log(`received ${signal}; draining`);
    signalAll('SIGTERM');

    const deadline = setTimeout(() => signalAll('SIGKILL'), 15_000);
    deadline.unref();

    const settle = setInterval(() => {
      const running = [...children.values()].some((c) => c.exitCode === null && c.signalCode === null);
      if (running) return;
      clearInterval(settle);
      clearTimeout(deadline);
      process.exit(0);
    }, 100);
  });
}
