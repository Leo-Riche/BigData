'use strict';

/**
 * Alimentation de la base e-commerce sur MySQL.
 * Les donnees viennent de data.js (partagees avec seed.supabase.js).
 *
 * Usage :
 *   npm install
 *   npm run schema   # (re)cree les tables depuis schema.sql
 *   npm run seed     # vide puis remplit les tables
 */

const mysql = require('mysql2/promise');
const { buildRows, INSERT_ORDER, verifierCoherence, resume, COMPTES_DEMO } = require('./data');

const CONFIG = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'shop',
};

async function reset(conn) {
  // TRUNCATE declenche un commit implicite : on vide avant d'ouvrir la transaction.
  await conn.query('SET FOREIGN_KEY_CHECKS = 0');
  for (const [table] of [...INSERT_ORDER].reverse()) {
    await conn.query(`TRUNCATE TABLE \`${table}\``);
  }
  await conn.query('SET FOREIGN_KEY_CHECKS = 1');
  console.log('Tables videes.');
}

async function insertAll(conn, rows) {
  for (const [table, columns] of INSERT_ORDER) {
    const data = rows[table] || [];
    if (data.length === 0) {
      console.log(`  ${table.padEnd(16)} 0 ligne`);
      continue;
    }
    const cols = columns.map((c) => `\`${c}\``).join(', ');
    await conn.query(`INSERT INTO \`${table}\` (${cols}) VALUES ?`, [data]);
    console.log(`  ${table.padEnd(16)} ${data.length} ligne(s)`);
  }
}

async function main() {
  const conn = await mysql.createConnection(CONFIG);
  console.log(`Connecte a ${CONFIG.user}@${CONFIG.host}:${CONFIG.port}/${CONFIG.database}`);

  try {
    const incoherences = verifierCoherence();
    if (incoherences.length) {
      console.error(`${incoherences.length} incoherence(s) detectee(s), rien n'a ete insere :`);
      for (const e of [...new Set(incoherences)].slice(0, 20)) console.error('  - ' + e);
      process.exitCode = 1;
      return;
    }
    console.log('Garde-fou : jeu de donnees coherent.');

    await reset(conn);
    const rows = buildRows();

    await conn.beginTransaction();
    try {
      await insertAll(conn, rows);
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    }

    const total = Object.values(rows).reduce((n, r) => n + r.length, 0);
    const r = resume();
    console.log(`\nSeed termine : ${total} lignes inserees.`);
    console.log(`Commandes par statut : ${Object.entries(r.parStatut).map(([k, v]) => `${k} ${v}`).join(', ')}`);
    console.log(`Comptes de test : ${COMPTES_DEMO.join(', ')}, ...`);
    console.log('Mot de passe commun : voir la constante SEED_PASSWORD dans data.js.');
  } finally {
    await conn.end();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Echec du seed :', err.message);
    process.exit(1);
  });
}
