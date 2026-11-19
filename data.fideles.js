'use strict';

/**
 * Lot "clients fideles" : des comptes avec un historique d'achat dense sur les
 * douze derniers mois, pour que les classements par client aient un sens.
 *
 * Pourquoi ce lot existe : dans les jeux precedents, les commandes sont
 * reparties sur beaucoup de comptes et peu de commandes chacun. Le 50e client
 * du classement se retrouve a 4 commandes, a egalite avec 36 autres : le
 * decoupage du top 50 serait arbitraire. Ici, soixante clients recoivent un
 * volume de commandes echelonne de 25 a 6, ce qui produit un classement
 * reellement ordonne, avec une queue de distribution en dessous.
 *
 * Coherence, comme pour les autres lots :
 *   - les lignes reprennent le catalogue existant a son prix courant, et
 *     seules les declinaisons dont le prix etait deja publie sont retenues ;
 *   - les clients sont inscrits avant leur premiere commande ;
 *   - le statut reste compatible avec l'anciennete de la commande ;
 *   - chaque fidele recoit en plus quelques commandes NON encaissees (panier
 *     en attente, commande annulee) : sans elles, un filtre sur le statut ne
 *     retirerait rien et ne prouverait rien.
 *
 * Generation deterministe : graine fixe, UUID derives d'une cle prefixee "fid:".
 */

const { INSERT_ORDER, uuid, jour, hashPassword, SEED_PASSWORD } = require('./data');
const { VILLES, CATALOGUE } = require('./data.volume');

// ---------------------------------------------------------------------------
// Parametres
// ---------------------------------------------------------------------------

const NB_FIDELES = 60;
const INSCRIPTION = -400;        // anterieure a la fenetre de 12 mois
const FENETRE = 350;             // commandes reparties sur les 350 derniers jours
const PALIER = 3;                // nombre de clients par niveau de volume
const VOLUME_MAX = 25;           // commandes encaissees du client le plus actif

/** Nombre de commandes encaissees visees pour le i-eme fidele. */
const volumeVise = (i) => VOLUME_MAX - Math.floor(i / PALIER);

/**
 * Les fideles ne sont rattaches qu'aux villes deja au-dessus de 30 commandes.
 * Sans ce filtre, leurs ~990 commandes feraient franchir le seuil aux six
 * petites villes que data.volume.js garde volontairement en dessous, et un
 * filtre "au moins 30 commandes" ne filtrerait plus rien.
 */
const VILLES_ELIGIBLES = VILLES.filter((v) => v.cible >= 30);

const PRENOMS = ['Agathe', 'Baptiste', 'Celine', 'Dorian', 'Eloise', 'Fabien', 'Garance', 'Hadrien',
  'Iris', 'Joachim', 'Kenza', 'Loic', 'Maelys', 'Nolan', 'Oceane', 'Pierrick', 'Quitterie',
  'Romain', 'Sixtine', 'Timothee', 'Ursule', 'Valentin', 'Wandrille', 'Xenia', 'Yohan', 'Zelie'];
const NOMS = ['Allard', 'Beaumont', 'Chartier', 'Delaunay', 'Esteve', 'Fournier', 'Gauthier',
  'Hamon', 'Imbert', 'Jacquet', 'Klein', 'Lacroix', 'Maillard', 'Noel', 'Olivier',
  'Pichon', 'Quemener', 'Renaud', 'Sabatier', 'Tissier'];
const RUES = ['rue des Tilleuls', 'avenue Foch', 'boulevard Voltaire', 'rue Lafayette',
  'place Saint-Michel', 'rue du Port', 'allee des Chenes', 'rue Berthelot'];

// ---------------------------------------------------------------------------
// Outils deterministes
// ---------------------------------------------------------------------------

function prng(graine) {
  let a = graine >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rnd = prng(19112026);
const entier = (min, max) => min + Math.floor(rnd() * (max - min + 1));
const tirer = (t) => t[Math.floor(rnd() * t.length)];
const chance = (p) => rnd() < p;
const ID = (cle) => uuid(`fid:${cle}`);

function tirerPlusieurs(tableau, n) {
  const copie = tableau.slice();
  const sortie = [];
  for (let i = 0; i < n && copie.length; i += 1) {
    sortie.push(copie.splice(Math.floor(rnd() * copie.length), 1)[0]);
  }
  return sortie;
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

const clients = [];
const commandes = [];
let numeroCommande = 0;

/** Cree une commande pour ce client, a l'age donne et avec ce statut. */
function creerCommande(client, age, statut) {
  const date = jour(-age, entier(8, 20));
  const eligibles = CATALOGUE.filter((c) => c.depuis <= date);
  if (eligibles.length === 0) return null;

  numeroCommande += 1;
  return {
    cle: `cmd-${numeroCommande}`,
    id: ID(`cmd-${numeroCommande}`),
    numero: `ORD-F-${String(numeroCommande).padStart(6, '0')}`,
    date,
    age,
    statut,
    clientId: client.id,
    rue: client.rue,
    ville: client.ville,
    lignes: tirerPlusieurs(eligibles, entier(1, 4)).map((c) => ({
      varianteId: c.varianteId,
      quantite: entier(1, 3),
      prixUnitaire: c.prix,
    })),
  };
}

for (let i = 0; i < NB_FIDELES; i += 1) {
  const prenom = PRENOMS[i % PRENOMS.length];
  const nomFamille = NOMS[(i * 3) % NOMS.length];
  const ville = VILLES_ELIGIBLES[i % VILLES_ELIGIBLES.length];
  const cle = `client-${i}`;

  const client = {
    cle,
    id: ID(cle),
    nom: `${prenom} ${nomFamille}`,
    email: `${prenom}.${nomFamille}.f${i}`.toLowerCase() + '@example.com',
    telephone: `+338${String(10000000 + i * 211).slice(0, 8)}`,
    rue: `${entier(1, 150)} ${tirer(RUES)}`,
    ville,
    vise: volumeVise(i),
  };
  clients.push(client);

  // Commandes encaissees, reparties sur les douze derniers mois.
  // Le statut depend de l'anciennete : recent = expedie, ancien = livre.
  for (let k = 0; k < client.vise; k += 1) {
    const age = entier(2, FENETRE);
    const statut = age <= 14 ? 'shipped' : 'delivered';
    const commande = creerCommande(client, age, statut);
    if (commande) commandes.push(commande);
  }

  // Une commande recente encore au statut "paid" pour une partie d'entre eux :
  // payee mais pas encore expediee, ce qui est par nature recent.
  if (chance(0.4)) {
    const commande = creerCommande(client, entier(1, 20), 'paid');
    if (commande) commandes.push(commande);
  }

  // Commandes non encaissees : elles doivent etre exclues par le filtre.
  if (chance(0.5)) {
    const commande = creerCommande(client, entier(0, 5), 'pending');
    if (commande) commandes.push(commande);
  }
  if (chance(0.45)) {
    const commande = creerCommande(client, entier(5, FENETRE), 'cancelled');
    if (commande) commandes.push(commande);
  }
}

// ---------------------------------------------------------------------------
// Assemblage
// ---------------------------------------------------------------------------

function buildFidelesRows() {
  const rows = Object.fromEntries(INSERT_ORDER.map(([t]) => [t, []]));

  rows.User = clients.map((c) => [
    c.id, c.nom, c.email, hashPassword(SEED_PASSWORD, c.email), c.telephone,
    jour(INSCRIPTION, 0), jour(INSCRIPTION + 45, 0), true,
  ]);

  rows.Address = clients.map((c) => [
    ID(`adresse-${c.cle}`), c.id, 'shipping', c.rue, c.ville.nom, c.ville.cp, c.ville.pays, true,
  ]);

  rows.Order = commandes.map((c) => [
    c.id, c.clientId, c.numero, c.date, c.statut, 'EUR',
    null, null, null,
    c.rue, c.ville.nom, c.ville.cp, c.ville.pays, null,
  ]);

  rows.OrderItem = commandes.flatMap((c) =>
    c.lignes.map((l) => [
      ID(`ligne-${c.cle}-${l.varianteId}`), c.id, l.varianteId, l.quantite, l.prixUnitaire,
    ])
  );

  return rows;
}

// ---------------------------------------------------------------------------
// Garde-fou
// ---------------------------------------------------------------------------

function verifierFideles() {
  const erreurs = [];
  const bornes = { pending: [0, 7], paid: [0, 45], shipped: [1, 400], delivered: [2, 999], cancelled: [0, 999] };
  const inscription = jour(INSCRIPTION, 0);

  const emails = new Set();
  for (const c of clients) {
    if (emails.has(c.email)) erreurs.push(`User.email : doublon ${c.email}`);
    emails.add(c.email);
  }

  const numeros = new Set();
  for (const c of commandes) {
    if (numeros.has(c.numero)) erreurs.push(`Order.orderNumber : doublon ${c.numero}`);
    numeros.add(c.numero);

    if (c.date < inscription) erreurs.push(`${c.numero} : commande anterieure a l'inscription`);

    const [min, max] = bornes[c.statut];
    if (c.age < min || c.age > max) erreurs.push(`${c.numero} : statut ${c.statut} incompatible avec ${c.age} jours`);

    if (c.lignes.length === 0) erreurs.push(`${c.numero} : commande sans ligne`);

    const vues = new Set();
    for (const l of c.lignes) {
      if (vues.has(l.varianteId)) erreurs.push(`${c.numero} : declinaison en double`);
      vues.add(l.varianteId);
      if (l.quantite <= 0) erreurs.push(`${c.numero} : quantite non positive`);
      const prix = CATALOGUE.find((x) => x.varianteId === l.varianteId);
      if (!prix) erreurs.push(`${c.numero} : declinaison hors catalogue`);
      else if (prix.depuis > c.date) erreurs.push(`${c.numero} : prix non encore publie a cette date`);
      else if (Math.abs(prix.prix - l.prixUnitaire) > 0.001) {
        erreurs.push(`${c.numero} : prix facture ${l.prixUnitaire}, publie ${prix.prix}`);
      }
    }
  }

  // Le volume encaisse reellement produit doit correspondre au volume vise.
  for (const client of clients) {
    const encaissees = commandes.filter(
      (c) => c.clientId === client.id && ['paid', 'shipped', 'delivered'].includes(c.statut)
    ).length;
    if (encaissees < client.vise) {
      erreurs.push(`${client.email} : ${encaissees} commandes encaissees pour ${client.vise} visees`);
    }
  }

  return erreurs;
}

function resumeFideles() {
  const encaissees = commandes.filter((c) => ['paid', 'shipped', 'delivered'].includes(c.statut)).length;
  return {
    clients: clients.length,
    commandes: commandes.length,
    commandesEncaissees: encaissees,
    commandesEcartees: commandes.length - encaissees,
    lignes: commandes.reduce((n, c) => n + c.lignes.length, 0),
    volumeMax: VOLUME_MAX,
    volumeDu50e: volumeVise(49),
  };
}

module.exports = { buildFidelesRows, verifierFideles, resumeFideles };
