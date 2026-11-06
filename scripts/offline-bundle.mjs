#!/usr/bin/env node
// Fabrique le paquet d'installation hors ligne d'ARKSEN PRINT MANAGER (On-Premise sans Internet) :
// images Docker, fichiers Compose, installateurs Windows et Linux, agent de collecte, empreintes.
// Se lance sur un poste connecté, depuis le dépôt : node scripts/offline-bundle.mjs
//
//   --skip-build   réutilise les images déjà construites au lieu de les reconstruire
//   --out <dir>    dossier de sortie (dist/offline par défaut)
//   --no-agent     n'inclut pas l'agent de collecte Windows
//
// Voir docs/offline.md.
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { createGzip } from 'node:zlib';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const COMPOSE_DIR = 'infrastructure/compose';
const COMPOSE_FILES = ['compose.prod.yaml', 'compose.onprem.yaml', 'compose.offline.yaml'];
/** Services construits depuis le dépôt : leur image s'appelle arksen-prod-<service>. */
const BUILT_SERVICES = ['migrate', 'analytics', 'api', 'workers', 'web', 'nginx', 'backup'];
/** Images publiques utilisées telles quelles. */
const BASE_IMAGES = ['postgres:18-alpine', 'redis:7-alpine'];
/** Valeurs factices : Compose exige ces variables pour lire le fichier, la construction ne s'en sert pas. */
const BUILD_PLACEHOLDERS = {
  POSTGRES_USER: 'build',
  POSTGRES_PASSWORD: 'build',
  POSTGRES_DB: 'build',
  APP_DB_PASSWORD: 'build',
  SYSTEM_DB_PASSWORD: 'build',
  REDIS_PASSWORD: 'build',
  BETTER_AUTH_SECRET: 'build',
  CREDENTIALS_ENCRYPTION_KEY: 'build',
  PUBLIC_WEB_URL: 'https://build.invalid',
  SERVER_NAME: 'build.invalid',
};

const args = process.argv.slice(2);
const skipBuild = args.includes('--skip-build');
const withAgent = !args.includes('--no-agent');
const outIndex = args.indexOf('--out');
const outRoot = resolve(root, outIndex >= 0 ? args[outIndex + 1] : 'dist/offline');

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
    env: { ...process.env, ...options.env },
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0 && !options.allowFailure) {
    const detail = options.capture ? `\n${result.stderr}` : '';
    throw new Error(`échec de « ${command} ${commandArgs.join(' ')} »${detail}`);
  }
  return result;
}

function step(message) {
  console.log(`\n== ${message}`);
}

/** Version du paquet : version du produit et commit, « -modifie » si des fichiers suivis ont changé. */
function bundleVersion() {
  const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const commit = run('git', ['rev-parse', '--short', 'HEAD'], { capture: true }).stdout.trim();
  const dirty = run('git', ['status', '--porcelain', '--untracked-files=no'], {
    capture: true,
  }).stdout.trim();
  return `${version}-${commit}${dirty ? '-modifie' : ''}`;
}

function imageExists(reference) {
  return (
    run('docker', ['image', 'inspect', reference], { capture: true, allowFailure: true }).status ===
    0
  );
}

async function saveImages(references, target) {
  const docker = spawn('docker', ['save', ...references], { cwd: root });
  let stderr = '';
  docker.stderr.on('data', (chunk) => (stderr += chunk));
  const exited = new Promise((resolveExit, rejectExit) => {
    docker.on('error', rejectExit);
    docker.on('close', resolveExit);
  });
  await pipeline(docker.stdout, createGzip({ level: 6 }), createWriteStream(target));
  const code = await exited;
  if (code !== 0) {
    throw new Error(`échec de docker save : ${stderr.trim()}`);
  }
}

async function sha256(file) {
  const hash = createHash('sha256');
  await pipeline(createReadStream(file), hash);
  return hash.digest('hex');
}

function listFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? listFiles(path) : [path];
  });
}

function copy(source, target) {
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(join(root, source), target);
}

function sizeLabel(bytes) {
  return bytes >= 1024 ** 3
    ? `${(bytes / 1024 ** 3).toFixed(2).replace('.', ',')} Go`
    : `${Math.round(bytes / 1024 ** 2)} Mo`;
}

const version = bundleVersion();
const bundle = join(outRoot, `arksen-onprem-${version}`);
console.log(`Paquet hors ligne ARKSEN ${version}`);

const composeArgs = COMPOSE_FILES.slice(0, 2).flatMap((file) => ['-f', `${COMPOSE_DIR}/${file}`]);
if (skipBuild) {
  step('Images existantes (--skip-build)');
} else {
  step('Construction des images');
  run('docker', ['compose', ...composeArgs, 'build', ...BUILT_SERVICES], {
    env: BUILD_PLACEHOLDERS,
  });
}

step('Préparation des images');
for (const image of BASE_IMAGES) {
  if (!imageExists(image)) {
    run('docker', ['pull', image]);
  }
}
const references = [...BASE_IMAGES];
for (const service of BUILT_SERVICES) {
  const latest = `arksen-prod-${service}:latest`;
  if (!imageExists(latest)) {
    throw new Error(`image ${latest} introuvable : relancez sans --skip-build`);
  }
  const versioned = `arksen-prod-${service}:${version}`;
  run('docker', ['tag', latest, versioned]);
  references.push(versioned);
  console.log(`  ${versioned}`);
}

rmSync(bundle, { recursive: true, force: true });
mkdirSync(join(bundle, 'images'), { recursive: true });

step('Export des images (plusieurs minutes)');
await saveImages(references, join(bundle, 'images', 'arksen-images.tar.gz'));

step('Fichiers d’installation');
for (const file of COMPOSE_FILES) {
  copy(`${COMPOSE_DIR}/${file}`, join(bundle, COMPOSE_DIR, file));
}
copy('.env.production.example', join(bundle, '.env.production.example'));
copy('infrastructure/offline/install.ps1', join(bundle, 'install.ps1'));
copy('infrastructure/offline/install.sh', join(bundle, 'install.sh'));
copy('docs/offline.md', join(bundle, 'LISEZMOI.md'));
writeFileSync(join(bundle, 'VERSION'), `${version}\n`);

if (withAgent) {
  const agentDist = join(root, 'services/collector/dist');
  const archives = existsSync(agentDist)
    ? readdirSync(agentDist).filter((name) => /^arksen-collector-.+\.zip$/.test(name))
    : [];
  if (archives.length === 0) {
    console.warn(
      '  Agent de collecte absent : construisez-le d’abord (services/collector/packaging/build.ps1)',
    );
  }
  for (const archive of archives) {
    copy(`services/collector/dist/${archive}`, join(bundle, 'agent', archive));
    console.log(`  agent/${archive}`);
  }
}

step('Empreintes SHA-256');
const lines = [];
for (const file of listFiles(bundle).sort()) {
  const path = relative(bundle, file).split(sep).join('/');
  lines.push(`${await sha256(file)}  ${path}`);
}
writeFileSync(join(bundle, 'SHA256SUMS.txt'), `${lines.join('\n')}\n`);

const total = listFiles(bundle).reduce((sum, file) => sum + statSync(file).size, 0);
console.log(`\nPaquet prêt : ${bundle} (${sizeLabel(total)})`);
console.log('Copiez ce dossier sur une clé USB (exFAT ou NTFS), puis suivez LISEZMOI.md.');
