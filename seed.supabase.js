'use strict';

/**
 * Alimentation de la base e-commerce sur Supabase (PostgreSQL).
 * Les donnees viennent de data.js (partagees avec seed.js / MySQL).
 *
 * Usage :
 *   npm install
 *   $env:DATABASE_URL="postgresql://postgres.<ref>:<mdp>@<host>:5432/postgres"
 *   npm run setup:supabase   # cree les tables PUIS les remplit
 *   npm run seed:supabase    # vide puis remplit les tables (schema deja en place)
 *
 * La chaine de connexion se copie dans le dashboard Supabase, bouton "Connect"
 * en haut de la page du projet. Prendre "Session pooler" (port 5432) : il est
 * joignable en IPv4, contrairement a la connexion directe qui est en IPv6 seul
 * sur les plans Free et Pro. Le port 6543 (transaction mode) est destine aux
 * fonctions serverless, pas a un script comme celui-ci.
 *
 * Si le mot de passe contient des caracteres reserves (@ : / ? # [ ] %), il
 * faut les encoder en pourcentage dans l'URL (@ devient %40, etc.).
 */

const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');
const { buildRows, INSERT_ORDER, verifierCoherence, resume, COMPTES_DEMO } = require('./data');

const DATABASE_URL = process.env.DATABASE_URL;
const CA_CERT_PATH = process.env.SUPABASE_CA_CERT; // optionnel

if (!DATABASE_URL) {
  console.error('DATABASE_URL non definie.');
  console.error('');
  console.error('1. Copier .env.example en .env (le fichier .env.example n est pas lu).');
  console.error('2. Y renseigner DATABASE_URL : dashboard Supabase > bouton "Connect"');
  console.error('   > onglet "Direct / Connection string" > Session pooler (port 5432).');
  console.error('3. Relancer la commande npm (les scripts npm chargent .env automatiquement).');
  console.error('');
  console.error('Alternative sans fichier : $env:DATABASE_URL="postgresql://..." puis');
  console.error('node seed.supabase.js --schema dans la meme fenetre PowerShell.');
  process.exit(1);
}

/**
 * Supabase impose TLS. Deux modes :
 *   - SUPABASE_CA_CERT pointe vers le certificat telecharge depuis le dashboard
 *     (Settings > Database > SSL Configuration) : verification complete.
 *   - sinon : chiffrement sans verification de la chaine. Suffisant pour un
 *     seed de donnees fictives, a ne pas garder pour du code de production.
 */
function sslConfig() {
  // Postgres local (docker, dev) : pas de TLS.
  if (process.env.PGSSL === 'disable' || /[?&]sslmode=disable/.test(DATABASE_URL)) {
    return false;
  }
  if (CA_CERT_PATH) {
    return { ca: fs.readFileSync(CA_CERT_PATH, 'utf8'), rejectUnauthorized: true };
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

async function applySchema(client) {
  const file = path.join(__dirname, 'schema.supabase.sql');
  const sql = fs.readFileSync(file, 'utf8');
  await client.query(sql);
  console.log('schema.supabase.sql applique.');
}

async function reset(client) {
  const tables = INSERT_ORDER.map(([t]) => `"${t}"`).join(', ');
  await client.query(`TRUNCATE TABLE ${tables} RESTART IDENTITY CASCADE`);
  console.log('Tables videes.');
}

async function insertAll(client, rows) {
  for (const [table, columns] of INSERT_ORDER) {
    const data = rows[table] || [];
    if (data.length === 0) {
      console.log(`  ${table.padEnd(16)} 0 ligne`);
      continue;
    }
    const cols = columns.map((c) => `"${c}"`).join(', ');
    const params = [];
    const tuples = data.map((row) => {
      const placeholders = row.map((value) => {
        params.push(value);
        return `$${params.length}`;
      });
      return `(${placeholders.join(', ')})`;
    });
    await client.query(`INSERT INTO "${table}" (${cols}) VALUES ${tuples.join(', ')}`, params);
    console.log(`  ${table.padEnd(16)} ${data.length} ligne(s)`);
  }
}

async function main() {
  const withSchema = process.argv.includes('--schema');

  const client = new Client({ connectionString: DATABASE_URL, ssl: sslConfig() });
  await client.connect();
  console.log(`Connecte a ${describeTarget(DATABASE_URL)}`);

  try {
    // Garde-fou : on verifie la coherence du jeu genere AVANT d'ecrire.
    const incoherences = verifierCoherence();
    if (incoherences.length) {
      console.error(`${incoherences.length} incoherence(s) detectee(s), rien n'a ete insere :`);
      for (const e of [...new Set(incoherences)].slice(0, 20)) console.error('  - ' + e);
      process.exitCode = 1;
      return;
    }
    console.log('Garde-fou : jeu de donnees coherent.');

    const rows = buildRows();

    // PostgreSQL sait annuler du DDL : schema et donnees passent dans la meme
    // transaction. Si quoi que ce soit echoue, la base reste dans son etat
    // precedent plutot qu'a moitie migree.
    await client.query('BEGIN');
    try {
      if (withSchema) await applySchema(client);
      await reset(client);
      await insertAll(client, rows);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }

    const { rows: check } = await client.query(
      `SELECT (SELECT count(*) FROM "Product")  AS produits,
              (SELECT count(*) FROM "User")     AS clients,
              (SELECT count(*) FROM "Order")    AS commandes,
              (SELECT count(*) FROM "OrderItem") AS lignes`
    );
    const total = Object.values(rows).reduce((n, r) => n + r.length, 0);
    const r = resume();

    console.log(`\nSeed termine : ${total} lignes inserees.`);
    console.log(`Relecture en base : ${check[0].clients} clients, ${check[0].produits} produits, ` +
      `${check[0].commandes} commandes, ${check[0].lignes} lignes de commande.`);
    console.log(`\nCommandes par statut : ${Object.entries(r.parStatut).map(([k, v]) => `${k} ${v}`).join(', ')}`);
    console.log(`Dont ${r.commandesInvite} passees par un invite et ${r.commandesAvecPromo} avec une promotion.`);
    console.log(`Catalogue : ${r.declinaisons} declinaisons, ${r.lignesDePrix} lignes de prix ` +
      `dont ${r.prixClotures} periodes closes.`);
    console.log(`\nComptes de test : ${COMPTES_DEMO.join(', ')}, ...`);
    console.log('Mot de passe commun : voir la constante SEED_PASSWORD dans data.js.');
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Echec du seed :', err.message);
    if (err.code === 'ENOTFOUND') {
      console.error('Hote introuvable : verifier la chaine copiee depuis le bouton "Connect".');
    }
    if (err.code === 'ENETUNREACH') {
      console.error('Reseau injoignable : utiliser le "Session pooler" (IPv4) plutot que la connexion directe (IPv6).');
    }
    if (err.code === '28P01') {
      console.error('Mot de passe refuse : encoder les caracteres speciaux dans l URL (@ -> %40).');
    }
    process.exit(1);
  });
}
