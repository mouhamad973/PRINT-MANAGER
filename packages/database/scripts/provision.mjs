#!/usr/bin/env node
// Provisionne les rôles PostgreSQL de l'application, de façon idempotente.
//
//   node scripts/provision.mjs roles   avant `prisma migrate deploy`
//   node scripts/provision.mjs grants  après `prisma migrate deploy`
//
// - arksen_app    : rôle de l'API pour les données métier, soumis au Row-Level Security.
// - arksen_system : rôle de l'authentification et des opérations de plateforme (BYPASSRLS).
// Le propriétaire (DATABASE_URL) ne sert qu'aux migrations.
import pg from 'pg';

const APP_ROLE = 'arksen_app';
const SYSTEM_ROLE = 'arksen_system';

// Tables de l'authentification : jamais accessibles au rôle métier.
const AUTH_TABLES = ['sessions', 'accounts', 'verifications'];
const PRISMA_TABLE = '_prisma_migrations';

const step = process.argv[2];
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || !['roles', 'grants'].includes(step)) {
  console.error('Usage : DATABASE_URL=... node scripts/provision.mjs <roles|grants>');
  process.exit(1);
}

function requirePassword(name) {
  const value = process.env[name];
  if (!value || value.length < 16) {
    console.error(`${name} manquant ou trop court (16 caractères minimum).`);
    process.exit(1);
  }
  return value;
}

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();

async function ensureRole(role, password, attributes) {
  const exists = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [role]);
  const verb = exists.rowCount === 0 ? 'CREATE' : 'ALTER';
  // Le mot de passe est réappliqué à chaque déploiement : sa rotation passe par l'environnement.
  await client.query(
    `${verb} ROLE ${client.escapeIdentifier(role)} WITH LOGIN ${attributes} PASSWORD ${client.escapeLiteral(password)}`,
  );
  console.log(`Rôle ${role} ${verb === 'CREATE' ? 'créé' : 'mis à jour'}`);
}

try {
  if (step === 'roles') {
    await ensureRole(
      APP_ROLE,
      requirePassword('APP_DB_PASSWORD'),
      'NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS',
    );
    await ensureRole(
      SYSTEM_ROLE,
      requirePassword('SYSTEM_DB_PASSWORD'),
      'NOSUPERUSER NOCREATEDB NOCREATEROLE BYPASSRLS',
    );
  } else {
    const { rows } = await client.query(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename",
    );
    const database = client.escapeIdentifier(
      (await client.query('SELECT current_database()')).rows[0].current_database,
    );
    await client.query('BEGIN');
    for (const role of [APP_ROLE, SYSTEM_ROLE]) {
      const quotedRole = client.escapeIdentifier(role);
      await client.query(`GRANT CONNECT ON DATABASE ${database} TO ${quotedRole}`);
      await client.query(`GRANT USAGE ON SCHEMA public TO ${quotedRole}`);
      for (const { tablename } of rows) {
        const table = `public.${client.escapeIdentifier(tablename)}`;
        const allowed =
          tablename !== PRISMA_TABLE && (role === SYSTEM_ROLE || !AUTH_TABLES.includes(tablename));
        await client.query(
          allowed
            ? `GRANT SELECT, INSERT, UPDATE, DELETE ON ${table} TO ${quotedRole}`
            : `REVOKE ALL ON ${table} FROM ${quotedRole}`,
        );
      }
      await client.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${quotedRole}`);
    }
    await client.query('COMMIT');
    console.log(`Droits appliqués sur ${rows.length} tables`);
  }
} catch (error) {
  await client.query('ROLLBACK').catch(() => {});
  console.error(`Provisionnement en échec : ${error.message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
