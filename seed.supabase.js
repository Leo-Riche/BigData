'use strict';

/**
 * Alimentation de la base e-commerce sur Supabase (PostgreSQL).
 *
 * Un seul point d'entree pour les cinq lots de donnees :
 *
 *   1. data.js           jeu principal genere     ~1 080 lignes
 *   2. data.extra.js     complement ecrit a la main   5 lignes par table
 *   3. data.volume.js    commandes sur 30 villes  ~1 260 commandes
 *   4. data.fideles.js   60 clients a historique dense
 *   5. data.catalogue.js 15 declinaisons dormantes
 *
 * Modes :
 *   npm run setup:supabase    schema.supabase.sql puis toutes les donnees
 *   npm run seed:supabase     vide les tables puis reinsere toutes les donnees
 *   npm run append:supabase   insere sans rien vider, en ignorant l'existant
 *
 * La chaine de connexion se copie dans le dashboard Supabase, bouton "Connect",
 * onglet "Direct / Connection string", mode "Session pooler" (port 5432) : il
 * est joignable en IPv4, contrairement a la connexion directe qui est en IPv6
 * seul sur les plans Free et Pro. Le port 6543 est reserve aux fonctions
 * serverless. La chaine se renseigne dans .env (voir .env.example).
 */

const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');

const { buildRows, INSERT_ORDER, verifierCoherence, resume, COMPTES_DEMO } = require('./data');
const { buildExtraRows, verifierExtra, ID_PROMOTIONS } = require('./data.extra');
const { buildVolumeRows, verifierVolume, resumeVolume } = require('./data.volume');
const { buildFidelesRows, verifierFideles, resumeFideles } = require('./data.fideles');
const { buildCatalogueRows, verifierCatalogue, resumeCatalogue } = require('./data.catalogue');

// L'ordre compte : le jeu principal cree les categories et les declinaisons
// auxquelles les lots suivants se rattachent.
const LOTS = [
  { nom: 'principal', build: buildRows, verifier: verifierCoherence },
  { nom: 'complement', build: buildExtraRows, verifier: verifierExtra },
  { nom: 'volumetrique', build: buildVolumeRows, verifier: verifierVolume },
  { nom: 'fideles', build: buildFidelesRows, verifier: verifierFideles },
  { nom: 'catalogue', build: buildCatalogueRows, verifier: verifierCatalogue },
];

// PostgreSQL plafonne a 65535 parametres par requete : on insere par paquets.
const PAQUET = 400;

const DATABASE_URL = process.env.DATABASE_URL;
const CA_CERT_PATH = process.env.SUPABASE_CA_CERT;

if (!DATABASE_URL) {
  console.error('DATABASE_URL non definie.');
  console.error('');
  console.error('1. Copier .env.example en .env (le fichier .env.example n est pas lu).');
  console.error('2. Y renseigner DATABASE_URL : dashboard Supabase > bouton "Connect"');
  console.error('   > onglet "Direct / Connection string" > Session pooler (port 5432).');
  console.error('3. Relancer la commande npm (les scripts npm chargent .env automatiquement).');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Connexion
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

async function applySchema(client) {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.supabase.sql'), 'utf8');
  await client.query(sql);
  console.log('schema.supabase.sql applique.');
}

async function vider(client) {
  const tables = INSERT_ORDER.map(([t]) => `"${t}"`).join(', ');
  await client.query(`TRUNCATE TABLE ${tables} RESTART IDENTITY CASCADE`);
  console.log('Tables videes.');
}

/** Fusionne les lots table par table, en conservant l'ordre d'insertion. */
function fusionner(lots) {
  const rows = {};
  for (const [table] of INSERT_ORDER) {
    rows[table] = lots.flatMap((lot) => lot[table] || []);
  }
  return rows;
}

async function inserer(client, rows, append) {
  let total = 0;
  for (const [table, columns] of INSERT_ORDER) {
    const data = rows[table] || [];
    if (data.length === 0) {
      console.log(`  ${table.padEnd(16)}      0`);
      continue;
    }

    const cols = columns.map((c) => `"${c}"`).join(', ');
    // En ajout, on ignore ce qui est deja la. PromotionTarget n'ayant aucune
    // contrainte d'unicite, ON CONFLICT n'a rien a quoi se raccrocher : ses
    // lignes sont supprimees puis reinserees (voir plus bas).
    const suffixe = append && table !== 'PromotionTarget' ? ' ON CONFLICT DO NOTHING' : '';

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
    console.log(`  ${table.padEnd(16)} ${String(ajoutees).padStart(6)}` +
      (ignorees ? `   (${ignorees} deja presente(s))` : ''));
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

/** Quelques controles de volumetrie, utiles aux requetes d'analyse. */
async function controler(client) {
  const { rows } = await client.query(`
    SELECT
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
                           WHERE oi."productVariantId" = pv.id)) AS invendues
  `);
  return rows[0];
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

async function main() {
  const avecSchema = process.argv.includes('--schema');
  const append = process.argv.includes('--append');

  if (avecSchema && append) {
    console.error('--schema recree les tables, donc vides : --append n a pas de sens avec.');
    process.exitCode = 1;
    return;
  }

  // Garde-fou : la coherence des cinq lots est verifiee AVANT toute ecriture.
  const incoherences = LOTS.flatMap((lot) => lot.verifier());
  if (incoherences.length) {
    console.error(`${incoherences.length} incoherence(s) detectee(s), rien n'a ete insere :`);
    for (const e of [...new Set(incoherences)].slice(0, 20)) console.error('  - ' + e);
    process.exitCode = 1;
    return;
  }

  const p = resume();
  const v = resumeVolume();
  const f = resumeFideles();
  const c = resumeCatalogue();
  console.log('Garde-fou : les cinq lots sont coherents.');
  console.log(`  principal    : ${p.commandes} commandes, ${p.clients} clients`);
  console.log(`  complement   : 5 lignes par table`);
  console.log(`  volumetrique : ${v.commandes} commandes sur ${v.villes} villes`);
  console.log(`  fideles      : ${f.clients} clients, ${f.commandes} commandes`);
  console.log(`  catalogue    : ${c.variantes} declinaisons dont ${c.activesInvendues} actives invendues`);

  const client = new Client({ connectionString: DATABASE_URL, ssl: sslConfig() });
  await client.connect();
  console.log(`\nConnecte a ${describeTarget(DATABASE_URL)}`);
  console.log(append ? 'Mode ajout : les tables ne sont pas videes.\n' : '');

  try {
    const avant = append ? await compter(client) : null;
    const rows = fusionner(LOTS.map((lot) => lot.build()));

    // PostgreSQL sait annuler du DDL : schema et donnees passent dans la meme
    // transaction. Si quoi que ce soit echoue, la base reste dans son etat
    // precedent plutot qu'a moitie migree.
    await client.query('BEGIN');
    try {
      if (avecSchema) await applySchema(client);
      if (append) {
        await client.query(
          'DELETE FROM "PromotionTarget" WHERE "promotionId" = ANY($1::uuid[])',
          [ID_PROMOTIONS]
        );
      } else {
        await vider(client);
      }
      const total = await inserer(client, rows, append);
      await client.query('COMMIT');
      console.log(`\n${total} ligne(s) ${append ? 'ajoutee(s)' : 'inseree(s)'}.`);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }

    const apres = await compter(client);
    if (append) {
      console.log('\nTable             avant   apres');
      for (const [table] of INSERT_ORDER) {
        console.log(`  ${table.padEnd(16)} ${String(avant[table]).padStart(5)}  ${String(apres[table]).padStart(6)}`);
      }
    }

    const ctrl = await controler(client);
    console.log(`\nRelecture en base : ${apres.User} clients, ${apres.Product} produits, ` +
      `${apres.ProductVariant} declinaisons, ${apres.Order} commandes, ${apres.OrderItem} lignes.`);
    console.log(`  ${ctrl.villes} villes a 30 commandes ou plus`);
    console.log(`  ${ctrl.clients} clients a 8 commandes encaissees ou plus sur 12 mois`);
    console.log(`  ${ctrl.invendues} declinaisons actives jamais achetees`);
    console.log(`\nComptes de test : ${COMPTES_DEMO.join(', ')}, ...`);
    console.log('Mot de passe commun : voir la constante SEED_PASSWORD dans data.js.');
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Echec du seed :', err.message);
    if (err.constraint) console.error(`Contrainte violee : ${err.constraint}`);
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
