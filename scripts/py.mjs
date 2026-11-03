#!/usr/bin/env node
// Exécute une commande dans l'environnement virtuel du service Python courant.
// Crée le venv et installe les dépendances au premier appel, sous Windows comme sous Linux.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const isWindows = process.platform === 'win32';
const venvPython = join('.venv', isWindows ? 'Scripts/python.exe' : 'bin/python');
const stamp = join('.venv', '.installed');
const lockDir = '.venv.lock';
const LOCK_STALE_MS = 15 * 60 * 1000;

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// Turbo lance lint, typecheck et test en parallèle : un seul processus prépare le venv.
function withLock(action) {
  for (;;) {
    try {
      mkdirSync(lockDir);
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') {
        throw error;
      }
      if (Date.now() - statSync(lockDir).mtimeMs > LOCK_STALE_MS) {
        rmSync(lockDir, { recursive: true, force: true });
      } else {
        sleep(500);
      }
    }
  }
  try {
    action();
  } finally {
    rmSync(lockDir, { recursive: true, force: true });
  }
}

withLock(() => {
  if (!existsSync(venvPython)) {
    run(isWindows ? 'py' : 'python3', [...(isWindows ? ['-3.12'] : []), '-m', 'venv', '.venv']);
  }

  const pyprojectTime = String(statSync('pyproject.toml').mtimeMs);
  if (!existsSync(stamp) || readFileSync(stamp, 'utf8') !== pyprojectTime) {
    run(venvPython, [
      '-m',
      'pip',
      'install',
      '--quiet',
      '--disable-pip-version-check',
      '-e',
      '.[dev]',
    ]);
    writeFileSync(stamp, pyprojectTime);
  }
});

run(venvPython, process.argv.slice(2));
