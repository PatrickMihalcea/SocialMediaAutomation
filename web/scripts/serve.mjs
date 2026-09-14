#!/usr/bin/env node
/**
 * Runs a Next server detached, so it outlives the terminal — or the agent
 * shell — that started it.
 *
 * `npm run dev` and `npm run start` both die with their parent shell, which is
 * why a server started in passing keeps disappearing. This spawns Next in its
 * own process group, writes a pidfile, and sends output to a log.
 *
 * The two modes keep separate build directories on purpose: `next dev` rewrites
 * its dist dir for development, and pointed at the same directory it deletes
 * the BUILD_ID and hashed chunks a running production server is serving.
 *
 * Usage:
 *   npm run serve            production server (needs npm run build first)
 *   npm run dev:bg           development server with hot reload
 *   npm run worker:bg        job worker (retries, sweeper, publishing)
 *   npm run serve:status     what is up, and where
 *   npm run serve:stop       stop both
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');

const MODES = {
  prod: {
    label: 'production',
    pidFile: path.join(root, '.server.pid'),
    logFile: path.join(root, 'logs', 'server.log'),
    distDir: '.next',
    defaultPort: '3100',
    args: (port) => ['next', 'start', '-p', port],
    needsBuild: true,
  },
  worker: {
    label: 'worker',
    pidFile: path.join(root, '.worker.pid'),
    logFile: path.join(root, 'logs', 'worker.log'),
    // Not a Next process; the dist dir is irrelevant to it.
    distDir: '.next',
    defaultPort: '',
    // Spawned through node rather than npx so --env-file applies; the worker
    // reads DATABASE_URL and the token key straight from .env, with no bundler
    // in front of it to inject them.
    command: 'node',
    // --watch outside production, because nothing else reloads this process.
    // The web server rebuilds on save while the worker keeps executing the code
    // it booted with, and a stale worker fails in ways that read as product
    // bugs: a node added since it started is reported as "a step type this
    // version cannot run", and a changed executor silently does the old thing.
    // Node restarts in place on change, so the pidfile stays valid.
    args: () => [
      '--env-file=.env',
      ...(process.env.NODE_ENV === 'production' ? [] : ['--watch']),
      '--import', 'tsx',
      'src/worker/index.ts',
    ],
    needsBuild: false,
    // The worker owns job execution and the run sweeper. Without it, a failed
    // step is never retried and a run can sit QUEUED forever.
    node: true,
  },
  dev: {
    label: 'development',
    pidFile: path.join(root, '.dev.pid'),
    logFile: path.join(root, 'logs', 'dev.log'),
    distDir: '.next-dev',
    defaultPort: '3000',
    args: (port) => ['next', 'dev', '--turbo', '-p', port],
    needsBuild: false,
  },
};

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

function readPid(mode) {
  if (!existsSync(mode.pidFile)) return null;
  const pid = Number(readFileSync(mode.pidFile, 'utf8').trim());
  if (!Number.isInteger(pid) || !alive(pid)) {
    // Stale pidfile from a process that is already gone.
    rmSync(mode.pidFile, { force: true });
    return null;
  }
  return pid;
}

function start(mode) {
  const port = process.env.PORT || mode.defaultPort;
  const running = readPid(mode);
  if (running) {
    console.log(`The ${mode.label} server is already running as pid ${running}.`);
    return;
  }
  if (mode.needsBuild && !existsSync(path.join(root, mode.distDir, 'BUILD_ID'))) {
    console.error(`No production build in ${mode.distDir}/. Run: npm run build`);
    process.exit(1);
  }

  mkdirSync(path.dirname(mode.logFile), { recursive: true });
  const out = openSync(mode.logFile, 'a');
  const child = spawn(mode.command ?? 'npx', mode.args(port), {
    cwd: root,
    // Its own process group, so a signal to this shell does not reach it.
    detached: true,
    stdio: ['ignore', out, out],
    env: {
      ...process.env,
      NEXT_DIST_DIR: mode.distDir,
      PORT: port,
      // The worker imports server-only modules directly rather than through
      // Next's bundler, so it needs the same resolution condition.
      ...(mode.node ? { NODE_OPTIONS: '--conditions=react-server' } : {}),
    },
  });
  child.unref();

  writeFileSync(mode.pidFile, String(child.pid));
  console.log(
    mode.defaultPort
      ? `Started the ${mode.label} server, pid ${child.pid}, on http://localhost:${port}`
      : `Started the ${mode.label}, pid ${child.pid}`,
  );
  console.log(`Logs: ${path.relative(root, mode.logFile)}`);
}

function stop(mode) {
  const pid = readPid(mode);
  if (!pid) {
    console.log(`The ${mode.label} server is not running.`);
    return;
  }
  // Negative pid signals the whole group, so Next's own children go too.
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    process.kill(pid, 'SIGTERM');
  }
  rmSync(mode.pidFile, { force: true });
  console.log(`Stopped the ${mode.label} server, pid ${pid}.`);
}

function status() {
  for (const mode of Object.values(MODES)) {
    const pid = readPid(mode);
    console.log(
      pid
        ? `${mode.label.padEnd(11)} pid ${pid}${mode.defaultPort ? `, serving ${mode.distDir}/` : ''}`
        : `${mode.label.padEnd(11)} not running`,
    );
  }
}

const command = process.argv[2] ?? 'status';
if (command === 'start') start(MODES.prod);
else if (command === 'dev') start(MODES.dev);
else if (command === 'worker') start(MODES.worker);
else if (command === 'stop') Object.values(MODES).forEach(stop);
else if (command === 'status') status();
else {
  console.error(`Unknown command "${command}". Use start, dev, stop or status.`);
  process.exit(1);
}
