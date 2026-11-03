#!/usr/bin/env node
// Vérifie la stack Docker démarrée, de bout en bout, à travers ses ports publiés.
const apiUrl = `http://localhost:${process.env.API_HOST_PORT ?? 4000}`;
const webUrl = `http://localhost:${process.env.WEB_HOST_PORT ?? 3000}`;
const analyticsUrl = `http://localhost:${process.env.ANALYTICS_HOST_PORT ?? 8000}`;

let failures = 0;

async function check(label, url, verify) {
  try {
    const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(10_000) });
    const detail = await verify(response);
    console.log(`OK     ${label}${detail ? ` (${detail})` : ''}`);
  } catch (error) {
    failures += 1;
    console.log(`ECHEC  ${label} : ${error.message}`);
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

await check('API /health : toutes les dépendances disponibles', `${apiUrl}/health`, async (r) => {
  const report = await r.json();
  const down = Object.entries(report.dependencies)
    .filter(([, dependency]) => dependency.status !== 'up')
    .map(([name]) => name);
  assert(r.status === 200, `HTTP ${r.status}`);
  assert(down.length === 0, `indisponibles : ${down.join(', ')}`);
  assert(report.status === 'ok', `statut ${report.status}`);
  return Object.entries(report.dependencies)
    .map(([name, dependency]) => `${name} ${dependency.latencyMs} ms`)
    .join(', ');
});

await check('API /api/v1/system/info', `${apiUrl}/api/v1/system/info`, async (r) => {
  assert(r.ok, `HTTP ${r.status}`);
  const info = await r.json();
  return `${info.name} ${info.version}, mode ${info.deploymentMode}`;
});

await check('API /docs : interface Swagger', `${apiUrl}/docs`, async (r) => {
  assert(r.ok, `HTTP ${r.status}`);
  assert((await r.text()).includes('swagger'), 'page Swagger attendue');
});

await check('API /docs/openapi.json', `${apiUrl}/docs/openapi.json`, async (r) => {
  assert(r.ok, `HTTP ${r.status}`);
  const paths = Object.keys((await r.json()).paths);
  assert(paths.includes('/health'), '/health absent du document');
  return `${paths.length} routes`;
});

await check('API /api/v1/me : accès anonyme refusé', `${apiUrl}/api/v1/me`, async (r) => {
  assert(r.status === 401, `HTTP ${r.status}, 401 attendu`);
});

await check('API /api/auth/ok : Better Auth monté', `${apiUrl}/api/auth/ok`, async (r) => {
  assert(r.ok, `HTTP ${r.status}`);
});

await check('Analytics /health', `${analyticsUrl}/health`, async (r) => {
  assert(r.ok, `HTTP ${r.status}`);
});

await check('Web : page protégée sans session', webUrl, async (r) => {
  assert(r.status === 307 || r.status === 308, `HTTP ${r.status}, redirection attendue`);
  const location = r.headers.get('location') ?? '';
  assert(location.includes('/login'), `redirection vers ${location}`);
});

await check('Web : page de connexion', `${webUrl}/login`, async (r) => {
  assert(r.ok, `HTTP ${r.status}`);
  assert((await r.text()).includes('ARKSEN'), 'marque absente de la page');
});

await check('Web : relais vers l’API', `${webUrl}/backend/health`, async (r) => {
  assert(r.ok, `HTTP ${r.status}`);
  assert((await r.json()).status === 'ok', 'statut attendu : ok');
});

await check('Web : relais vers Better Auth', `${webUrl}/backend/api/auth/ok`, async (r) => {
  assert(r.ok, `HTTP ${r.status}`);
});

if (failures > 0) {
  console.error(`\n${failures} vérification(s) en échec.`);
  process.exit(1);
}
console.log('\nToutes les vérifications ont réussi.');
