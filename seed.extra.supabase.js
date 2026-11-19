'use strict';

/**
 * Ajoute 5 lignes par table a une base Supabase DEJA remplie.
 *
 * Contrairement a seed.supabase.js, ce script ne vide rien : il insere.
 * Il est rejouable sans effet de bord, grace a ON CONFLICT DO NOTHING sur les
 * tables dotees d'une contrainte d'unicite, et a un nettoyage prealable des
 * cibles de promotion ajoutees (PromotionTarget n'a ni cle primaire ni
 * unicite, donc une seconde execution la dupliquerait).
 *
 * Usage :
 *   npm run extra:supabase
 */

const fs = require('node:fs');
const { Client } = require('pg');
const { INSERT_ORDER } = require('./data');
const { buildExtraRows, verifierExtra, ID_PROMOTIONS } = require('./data.extra');

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL non definie : renseigner .env (voir README).');
  process.exit(1);
}

function sslConfig() {
  if (process.env.PGSSL === 'disable' || /[?&]sslmode=disable/.test(DATABASE_URL)) return false;
  if (process.env.SUPABASE_CA_CERT) {
    return { ca: fs.readFileSync(process.env.SUPABASE_CA_CERT, 'utf8'), rejectUnauthorized: true };
  }
  console.warn('Avertissement : certificat serveur non verifie (SUPABASE_CA_CERT non definie).');
  return { rejectUnauthorized: false };
}

function describeTarget(url) {
  try {
    const u = new URL(url);
    return `${u.username}@${u.hostname}:${u.port || 5432}${u.pathname}`;
  } catch {
    return '(chaine de connexion illisible)';
  }
}

async function insertAll(client, rows) {
  let total = 0;
  for (const [table, columns] of INSERT_ORDER) {
    const data = rows[table] || [];
    if (data.length === 0) continue;

    const cols = columns.map((c) => `"${c}"`).join(', ');
    const params = [];
    const tuples = data.map((row) => {
      const placeholders = row.map((value) => {
        params.push(value);
        return `$${params.length}`;
      });
      return `(${placeholders.join(', ')})`;
    });

    // PromotionTarget n'a aucune contrainte d'unicite : ON CONFLICT n'a rien
    // a quoi se raccrocher, le nettoyage prealable suffit.
    const suffixe = table === 'PromotionTarget' ? '' : ' ON CONFLICT DO NOTHING';
    const res = await client.query(
      `INSERT INTO "${table}" (${cols}) VALUES ${tuples.join(', ')}${suffixe}`,
      params
    );
    const ignorees = data.length - res.rowCount;
    console.log(`  ${table.padEnd(16)} ${String(res.rowCount).padStart(2)} ajoutee(s)` +
      (ignorees ? ` (${ignorees} deja presente(s))` : ''));
    total += res.rowCount;
  }
  return total;
}

async function main() {
  const incoherences = verifierExtra();
  if (incoherences.length) {
    console.error(`${incoherences.length} incoherence(s), rien n'a ete insere :`);
    for (const e of incoherences) console.error('  - ' + e);
    process.exitCode = 1;
    return;
  }
  console.log('Garde-fou : complement coherent.');

  const client = new Client({ connectionString: DATABASE_URL, ssl: sslConfig() });
  await client.connect();
  console.log(`Connecte a ${describeTarget(DATABASE_URL)}`);

  try {
    const avant = await compter(client);
    const rows = buildExtraRows();

    await client.query('BEGIN');
    try {
      // Rend l'execution rejouable pour la seule table sans unicite.
      await client.query('DELETE FROM "PromotionTarget" WHERE "promotionId" = ANY($1::uuid[])', [ID_PROMOTIONS]);
      const total = await insertAll(client, rows);
      await client.query('COMMIT');
      console.log(`\n${total} ligne(s) ajoutee(s).`);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }

    const apres = await compter(client);
    console.log('\nTable            avant  apres');
    for (const [table] of INSERT_ORDER) {
      console.log(`  ${table.padEnd(16)} ${String(avant[table]).padStart(4)}  ${String(apres[table]).padStart(5)}`);
    }
  } finally {
    await client.end();
  }
}

async function compter(client) {
  const sousRequetes = INSERT_ORDER
    .map(([t], i) => `(SELECT count(*) FROM "${t}") AS t${i}`)
    .join(', ');
  const { rows } = await client.query(`SELECT ${sousRequetes}`);
  return Object.fromEntries(INSERT_ORDER.map(([t], i) => [t, Number(rows[0][`t${i}`])]));
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Echec de l ajout :', err.message);
    if (err.constraint) console.error(`Contrainte violee : ${err.constraint}`);
    process.exit(1);
  });
}
