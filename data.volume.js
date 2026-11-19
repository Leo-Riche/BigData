'use strict';

/**
 * Lot volumetrique : des commandes en nombre, reparties sur une trentaine de
 * villes, pour que les analyses par ville aient un sens statistique.
 *
 * Le jeu principal (data.js) ne compte que 150 commandes sur 11 villes : aucune
 * ville n'atteint les 30 commandes qu'exigent certaines requetes d'analyse.
 * Ce lot complete uniquement ce qu'il faut pour cela : des clients, leurs
 * adresses, des commandes et leurs lignes. Il ne touche ni au catalogue, ni aux
 * promotions, ni aux paniers, qui sont deja suffisamment fournis.
 *
 * Coherence :
 *   - les lignes de commande reprennent le CATALOGUE EXISTANT, au prix courant
 *     publie dans PriceHistory, et seules les declinaisons dont le prix courant
 *     etait deja en vigueur a la date de la commande sont retenues ;
 *   - les clients sont inscrits avant toutes leurs commandes ;
 *   - le statut reste compatible avec l'anciennete de la commande ;
 *   - tout est en EUR, pour que les totaux par ville soient additionnables.
 *
 * Comme data.js, la generation est deterministe : graine fixe, UUID derives
 * d'une cle metier prefixee "vol:".
 */

const { buildRows, INSERT_ORDER, uuid, jour, hashPassword, SEED_PASSWORD } = require('./data');

// ---------------------------------------------------------------------------
// Villes et volumes vises
// ---------------------------------------------------------------------------
// Les six dernieres villes restent volontairement sous les 30 commandes : sans
// elles, un filtre "au moins 30 commandes" ne filtrerait rien et ne prouverait
// rien.

const VILLES = [
  // Villes destinees a depasser le seuil
  { nom: 'Paris', cp: '75011', pays: 'FR', cible: 95 },
  { nom: 'Lyon', cp: '69003', pays: 'FR', cible: 78 },
  { nom: 'Marseille', cp: '13001', pays: 'FR', cible: 71 },
  { nom: 'Toulouse', cp: '31000', pays: 'FR', cible: 64 },
  { nom: 'Bordeaux', cp: '33000', pays: 'FR', cible: 58 },
  { nom: 'Lille', cp: '59000', pays: 'FR', cible: 55 },
  { nom: 'Nantes', cp: '44000', pays: 'FR', cible: 52 },
  { nom: 'Nice', cp: '06000', pays: 'FR', cible: 49 },
  { nom: 'Strasbourg', cp: '67000', pays: 'FR', cible: 47 },
  { nom: 'Montpellier', cp: '34000', pays: 'FR', cible: 45 },
  { nom: 'Rennes', cp: '35000', pays: 'FR', cible: 43 },
  { nom: 'Grenoble', cp: '38000', pays: 'FR', cible: 41 },
  { nom: 'Toulon', cp: '83000', pays: 'FR', cible: 39 },
  { nom: 'Angers', cp: '49000', pays: 'FR', cible: 38 },
  { nom: 'Le Havre', cp: '76600', pays: 'FR', cible: 36 },
  { nom: 'Clermont-Ferrand', cp: '63000', pays: 'FR', cible: 35 },
  { nom: 'Tours', cp: '37000', pays: 'FR', cible: 34 },
  { nom: 'Limoges', cp: '87000', pays: 'FR', cible: 33 },
  { nom: 'Bruxelles', cp: '1000', pays: 'BE', cible: 61 },
  { nom: 'Anvers', cp: '2000', pays: 'BE', cible: 44 },
  { nom: 'Liege', cp: '4000', pays: 'BE', cible: 37 },
  { nom: 'Geneve', cp: '1201', pays: 'CH', cible: 46 },
  { nom: 'Lausanne', cp: '1003', pays: 'CH', cible: 32 },
  { nom: 'Luxembourg', cp: '1111', pays: 'LU', cible: 40 },
  // Villes volontairement sous le seuil
  { nom: 'Dijon', cp: '21000', pays: 'FR', cible: 24 },
  { nom: 'Reims', cp: '51100', pays: 'FR', cible: 19 },
  { nom: 'Caen', cp: '14000', pays: 'FR', cible: 15 },
  { nom: 'Brest', cp: '29200', pays: 'FR', cible: 12 },
  { nom: 'Nancy', cp: '54000', pays: 'FR', cible: 9 },
  { nom: 'Amiens', cp: '80000', pays: 'FR', cible: 6 },
];

const PRENOMS = ['Camille', 'Lucas', 'Emma', 'Nathan', 'Lea', 'Enzo', 'Manon', 'Louis', 'Jade', 'Gabriel',
  'Alice', 'Raphael', 'Louise', 'Arthur', 'Chloe', 'Adam', 'Anna', 'Paul', 'Rose', 'Jules',
  'Sarah', 'Tom', 'Eva', 'Noah', 'Lina', 'Ethan', 'Mila', 'Sacha', 'Nina', 'Victor'];
const NOMS = ['Bernard', 'Thomas', 'Robert', 'Richard', 'Michel', 'Laurent', 'Simon', 'Lefebvre',
  'Legrand', 'Roux', 'Vincent', 'Muller', 'Faure', 'Andre', 'Guerin', 'Boyer', 'Barbier',
  'Arnaud', 'Martinez', 'Gerard'];
const RUES = ['rue de la Republique', 'avenue de la Liberation', 'boulevard Gambetta', 'rue Pasteur',
  'place du Marche', 'rue des Ecoles', 'avenue du General Leclerc', 'rue Jean Moulin',
  'cours Mirabeau', 'rue de la Paix'];

// Ancienneté des comptes : anterieure a toutes les commandes du lot.
const INSCRIPTION = -600;
const COMMANDE_LA_PLUS_ANCIENNE = -540;
const PART_INVITE = 0.4;

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

const rnd = prng(26112026);
const entier = (min, max) => min + Math.floor(rnd() * (max - min + 1));
const tirer = (t) => t[Math.floor(rnd() * t.length)];
const chance = (p) => rnd() < p;
const ID = (cle) => uuid(`vol:${cle}`);

function tirerPlusieurs(tableau, n) {
  const copie = tableau.slice();
  const sortie = [];
  for (let i = 0; i < n && copie.length; i += 1) {
    sortie.push(copie.splice(Math.floor(rnd() * copie.length), 1)[0]);
  }
  return sortie;
}

// ---------------------------------------------------------------------------
// Catalogue existant : declinaisons au prix courant en EUR
// ---------------------------------------------------------------------------
// On ne reprend que les periodes ouvertes (endDate NULL). Une commande posee
// apres le debut de cette periode tombe donc forcement dans cette periode et
// dans aucune autre : le prix facture ne peut pas diverger de l'historique.

const principal = buildRows();
const colonnes = Object.fromEntries(INSERT_ORDER);
const iPrix = colonnes.PriceHistory;

const CATALOGUE = principal.PriceHistory
  .map((r) => Object.fromEntries(iPrix.map((c, i) => [c, r[i]])))
  .filter((p) => p.endDate === null && p.currency === 'EUR')
  .map((p) => ({ varianteId: p.productVariantId, prix: Number(p.price), depuis: p.startDate }));

if (CATALOGUE.length === 0) {
  throw new Error('Aucun prix courant en EUR dans le jeu principal : lot volumetrique impossible.');
}

/** Statut plausible compte tenu de l'age de la commande, en jours. */
function statutSelonAge(age) {
  if (chance(0.05)) return 'cancelled';
  if (age <= 1) return chance(0.6) ? 'pending' : 'paid';
  if (age <= 4) return chance(0.5) ? 'paid' : 'shipped';
  if (age <= 14) return chance(0.35) ? 'shipped' : 'delivered';
  return 'delivered';
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

const clients = [];
const adresses = [];
const commandes = [];
let numeroCommande = 0;

for (const ville of VILLES) {
  const slug = ville.nom.toLowerCase().replace(/[^a-z]/g, '');

  // Un vivier de clients par ville : environ un client pour six commandes.
  const nbClients = Math.max(2, Math.ceil(ville.cible / 6));
  const viviers = [];
  for (let i = 0; i < nbClients; i += 1) {
    const prenom = tirer(PRENOMS);
    const nomFamille = tirer(NOMS);
    const cle = `client-${slug}-${i}`;
    const client = {
      cle,
      id: ID(cle),
      nom: `${prenom} ${nomFamille}`,
      email: `${prenom}.${nomFamille}.${slug}${i}`.toLowerCase() + '@example.com',
      telephone: `+337${String(10000000 + clients.length * 97).slice(0, 8)}`,
      rue: `${entier(1, 150)} ${tirer(RUES)}`,
      ville,
    };
    clients.push(client);
    viviers.push(client);

    adresses.push({
      id: ID(`adresse-${cle}`),
      clientId: client.id,
      rue: client.rue,
      ville,
    });
  }

  for (let i = 0; i < ville.cible; i += 1) {
    const jourCommande = chance(0.3) ? -entier(0, 30) : -entier(0, -COMMANDE_LA_PLUS_ANCIENNE);
    const dateCommande = jour(jourCommande, entier(8, 20));

    // Seules les declinaisons dont le prix courant etait deja publie.
    const eligibles = CATALOGUE.filter((c) => c.depuis <= dateCommande);
    if (eligibles.length === 0) continue;

    numeroCommande += 1;
    const client = chance(PART_INVITE) ? null : tirer(viviers);
    const prenom = tirer(PRENOMS);
    const nomFamille = tirer(NOMS);

    commandes.push({
      cle: `cmd-${numeroCommande}`,
      id: ID(`cmd-${numeroCommande}`),
      numero: `ORD-V-${String(numeroCommande).padStart(6, '0')}`,
      date: dateCommande,
      statut: statutSelonAge(-jourCommande),
      clientId: client ? client.id : null,
      invite: client ? null : {
        nom: `${prenom} ${nomFamille}`,
        email: `${prenom}.${nomFamille}.v${numeroCommande}`.toLowerCase() + '@example.com',
        telephone: `+337${String(50000000 + numeroCommande * 13).slice(0, 8)}`,
      },
      rue: client ? client.rue : `${entier(1, 150)} ${tirer(RUES)}`,
      ville,
      lignes: tirerPlusieurs(eligibles, entier(1, 4)).map((c) => ({
        varianteId: c.varianteId,
        quantite: entier(1, 3),
        prixUnitaire: c.prix,
      })),
    });
  }
}

// ---------------------------------------------------------------------------
// Assemblage
// ---------------------------------------------------------------------------

function buildVolumeRows() {
  const rows = Object.fromEntries(INSERT_ORDER.map(([t]) => [t, []]));

  rows.User = clients.map((c) => [
    c.id, c.nom, c.email, hashPassword(SEED_PASSWORD, c.email), c.telephone,
    jour(INSCRIPTION, 0), jour(INSCRIPTION + 30, 0), true,
  ]);

  rows.Address = adresses.map((a) => [
    a.id, a.clientId, 'shipping', a.rue, a.ville.nom, a.ville.cp, a.ville.pays, true,
  ]);

  rows.Order = commandes.map((c) => [
    c.id, c.clientId, c.numero, c.date, c.statut, 'EUR',
    c.invite ? c.invite.nom : null,
    c.invite ? c.invite.email : null,
    c.invite ? c.invite.telephone : null,
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

function verifierVolume() {
  const erreurs = [];
  const bornes = { pending: [0, 7], paid: [0, 45], shipped: [1, 400], delivered: [2, 999], cancelled: [0, 999] };
  const inscription = jour(INSCRIPTION, 0);

  const vus = new Set();
  for (const c of clients) {
    if (vus.has(c.email)) erreurs.push(`User.email : doublon ${c.email}`);
    vus.add(c.email);
  }

  const numeros = new Set();
  for (const c of commandes) {
    if (numeros.has(c.numero)) erreurs.push(`Order.orderNumber : doublon ${c.numero}`);
    numeros.add(c.numero);

    if (c.clientId === null && !c.invite) erreurs.push(`${c.numero} : ni client ni invite`);
    if (c.clientId !== null && c.invite) erreurs.push(`${c.numero} : client identifie ET invite`);
    if (c.clientId !== null && c.date < inscription) {
      erreurs.push(`${c.numero} : commande anterieure a l'inscription du client`);
    }

    const age = Math.round((Date.now() - c.date.getTime()) / 86400000);
    const [min, max] = bornes[c.statut];
    if (age < min || age > max) erreurs.push(`${c.numero} : statut ${c.statut} incompatible avec ${age} jours`);

    if (c.lignes.length === 0) erreurs.push(`${c.numero} : commande sans ligne`);

    const declinaisons = new Set();
    for (const l of c.lignes) {
      if (declinaisons.has(l.varianteId)) erreurs.push(`${c.numero} : declinaison en double`);
      declinaisons.add(l.varianteId);
      if (l.quantite <= 0) erreurs.push(`${c.numero} : quantite non positive`);
      if (l.prixUnitaire <= 0) erreurs.push(`${c.numero} : prix unitaire non positif`);
      const prix = CATALOGUE.find((x) => x.varianteId === l.varianteId);
      if (!prix) erreurs.push(`${c.numero} : declinaison hors catalogue`);
      else if (prix.depuis > c.date) erreurs.push(`${c.numero} : prix non encore publie a cette date`);
      else if (Math.abs(prix.prix - l.prixUnitaire) > 0.001) {
        erreurs.push(`${c.numero} : prix facture ${l.prixUnitaire}, publie ${prix.prix}`);
      }
    }
  }

  return erreurs;
}

/** Repartition visee, pour l'affichage. */
function resumeVolume() {
  const parVille = {};
  for (const c of commandes) parVille[c.ville.nom] = (parVille[c.ville.nom] || 0) + 1;
  return {
    villes: VILLES.length,
    clients: clients.length,
    commandes: commandes.length,
    lignes: commandes.reduce((n, c) => n + c.lignes.length, 0),
    parVille,
  };
}

module.exports = { buildVolumeRows, verifierVolume, resumeVolume, VILLES, CATALOGUE, statutSelonAge };
