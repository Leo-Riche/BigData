'use strict';

/**
 * Ajoute des donnees a une base Supabase DEJA remplie, sans rien vider.
 *
 * Deux lots, inseres dans la meme transaction :
 *   1. le complement de data.extra.js   : 5 lignes par table, ecrites a la main ;
 *   2. le lot volumetrique de data.volume.js : des commandes en nombre reparties
 *      sur une trentaine de villes, pour les analyses par ville.
 *
 * Le script est rejouable : ON CONFLICT DO NOTHING ignore ce qui est deja la,
 * et les cibles de promotion ajoutees sont supprimees avant reinsertion, faute
 * de contrainte d'unicite sur PromotionTarget.
 *
 * Usage :
 *   npm run extra:supabase
 */

const fs = require('node:fs');
const { Client } = require('pg');
const { INSERT_ORDER } = require('./data');
const { buildExtraRows, verifierExtra, ID_PROMOTIONS } = require('./data.extra');
const { buildVolumeRows, verifierVolume, resumeVolume } = require('./data.volume');
const { buildFidelesRows, verifierFideles, resumeFideles } = require('./data.fideles');
const { buildCatalogueRows, verifierCatalogue, resumeCatalogue } = require('./data.catalogue');

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL non definie : renseigner .env (voir README).');
  process.exit(1);
}

// PostgreSQL plafonne a 65535 parametres par requete : on insere par paquets.
const PAQUET = 400;

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

/** Fusionne les deux lots table par table, en conservant l'ordre d'insertion. */
function fusionner(lots) {
  const rows = {};
  for (const [table] of INSERT_ORDER) {
    rows[table] = lots.flatMap((lot) => lot[table] || []);
  }
  return rows;
}

async function insertAll(client, rows) {
  let total = 0;
  for (const [table, columns] of INSERT_ORDER) {
    const data = rows[table] || [];
    if (data.length === 0) continue;

    const cols = columns.map((c) => `"${c}"`).join(', ');
    // PromotionTarget n'a aucune contrainte d'unicite : ON CONFLICT n'a rien a
    // quoi se raccrocher, le nettoyage prealable suffit.
    const suffixe = table === 'PromotionTarget' ? '' : ' ON CONFLICT DO NOTHING';

    let ajoutees = 0;
    for (let debut = 0; debut < data.length; debut += PAQUET) {
      const paquet = data.slice(debut, debut + PAQUET);
      const params = [];
      const tuples = paquet.map((row) => {
        const placeholders = row.map((value) => {
          params.push(value);
          return `$${params.length}`;
        });
        return `(${placeholders.join(', ')})`;
      });
      const res = await client.query(
        `INSERT INTO "${table}" (${cols}) VALUES ${tuples.join(', ')}${suffixe}`,
        params
      );
      ajoutees += res.rowCount;
    }

    const ignorees = data.length - ajoutees;
    console.log(`  ${table.padEnd(16)} ${String(ajoutees).padStart(5)} ajoutee(s)` +
      (ignorees ? ` (${ignorees} deja presente(s))` : ''));
    total += ajoutees;
  }
  return total;
}

async function compter(client) {
  const sousRequetes = INSERT_ORDER
    .map(([t], i) => `(SELECT count(*) FROM "${t}") AS t${i}`)
    .join(', ');
  const { rows } = await client.query(`SELECT ${sousRequetes}`);
  return Object.fromEntries(INSERT_ORDER.map(([t], i) => [t, Number(rows[0][`t${i}`])]));
}

async function main() {
  const incoherences = [...verifierExtra(), ...verifierVolume(), ...verifierFideles(), ...verifierCatalogue()];
  if (incoherences.length) {
    console.error(`${incoherences.length} incoherence(s), rien n'a ete insere :`);
    for (const e of [...new Set(incoherences)].slice(0, 20)) console.error('  - ' + e);
    process.exitCode = 1;
    return;
  }
  const v = resumeVolume();
  const f = resumeFideles();
  console.log('Garde-fou : les trois lots sont coherents.');
  console.log(`  Complement       : 5 lignes par table`);
  console.log(`  Lot volumetrique : ${v.commandes} commandes sur ${v.villes} villes, ${v.clients} clients`);
  console.log(`  Clients fideles  : ${f.clients} clients, ${f.commandes} commandes ` +
    `(${f.commandesEncaissees} encaissees, ${f.commandesEcartees} non encaissees)`);
  const cat = resumeCatalogue();
  console.log(`  Catalogue dormant: ${cat.variantes} declinaisons ` +
    `(${cat.activesInvendues} actives invendues, ${cat.retireesInvendues} retirees invendues, ` +
    `${cat.retireesVendues} retirees vendues)`);

  const client = new Client({ connectionString: DATABASE_URL, ssl: sslConfig() });
  await client.connect();
  console.log(`Connecte a ${describeTarget(DATABASE_URL)}\n`);

  try {
    const avant = await compter(client);
    const rows = fusionner([buildExtraRows(), buildVolumeRows(), buildFidelesRows(), buildCatalogueRows()]);

    await client.query('BEGIN');
    try {
      await client.query('DELETE FROM "PromotionTarget" WHERE "promotionId" = ANY($1::uuid[])', [ID_PROMOTIONS]);
      const total = await insertAll(client, rows);
      await client.query('COMMIT');
      console.log(`\n${total} ligne(s) ajoutee(s).`);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }

    const apres = await compter(client);
    console.log('\nTable             avant   apres');
    for (const [table] of INSERT_ORDER) {
      console.log(`  ${table.padEnd(16)} ${String(avant[table]).padStart(5)}  ${String(apres[table]).padStart(6)}`);
    }

    const { rows: controle } = await client.query(
      `SELECT
         (SELECT count(*) FROM (
            SELECT "shippingCity" FROM "Order" GROUP BY "shippingCity" HAVING count(*) >= 30
          ) AS v) AS villes,
         (SELECT count(*) FROM (
            SELECT "userId" FROM "Order"
            WHERE "userId" IS NOT NULL
              AND status IN ('paid','shipped','delivered')
              AND "orderDate" >= now() - interval '12 months'
            GROUP BY "userId" HAVING count(*) >= 8
          ) AS c) AS clients,
         (SELECT count(*) FROM "ProductVariant" pv
           WHERE EXISTS (SELECT 1 FROM "PriceHistory" ph
                          WHERE ph."productVariantId" = pv.id AND ph."endDate" IS NULL)
             AND NOT EXISTS (SELECT 1 FROM "OrderItem" oi
                              WHERE oi."productVariantId" = pv.id)) AS invendues`
    );
    console.log(`\n${controle[0].villes} villes atteignent 30 commandes ou plus.`);
    console.log(`${controle[0].clients} clients ont 8 commandes encaissees ou plus sur 12 mois.`);
    console.log(`${controle[0].invendues} declinaisons actives n'ont jamais ete achetees.`);
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Echec de l ajout :', err.message);
    if (err.constraint) console.error(`Contrainte violee : ${err.constraint}`);
    process.exit(1);
  });
}
