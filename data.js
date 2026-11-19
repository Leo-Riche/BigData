'use strict';

/**
 * Generateur de donnees coherentes pour le modele drawSQL du 2026-11-18.
 *
 * Principes :
 *   - Generation pseudo-aleatoire mais DETERMINISTE : la graine est fixe, donc
 *     deux executions produisent exactement les memes lignes et les memes UUID.
 *   - Aucune donnee impossible : toutes les regles temporelles et metier sont
 *     verifiees par un garde-fou avant que quoi que ce soit ne soit insere
 *     (fonction verifierCoherence en bas de fichier). Si une invariante est
 *     violee, le script s'arrete au lieu d'ecrire.
 *
 * Ce que le modele permet de representer :
 *   - clients, adresses, catalogue, declinaisons, historique de prix, paniers,
 *     promotions et commandes.
 *   - le PAIEMENT et la LIVRAISON n'ont pas de table dediee dans le diagramme :
 *     ils sont portes par Order.status (pending -> paid -> shipped -> delivered,
 *     ou cancelled) et par les colonnes shipping* de Order.
 *   - le STOCK n'est representable nulle part dans ce modele : aucune table ni
 *     colonne de quantite disponible. Rien n'est genere pour lui.
 *
 * Consomme par seed.js (MySQL) et seed.supabase.js (PostgreSQL / Supabase).
 */

const crypto = require('node:crypto');

// ---------------------------------------------------------------------------
// Volumes et proportions
// ---------------------------------------------------------------------------

const PARAMS = {
  graine: 20261118,
  marques: 6,
  produits: 30,
  clients: 40,
  commandes: 150,
  promotions: 12,
  partClientsInactifs: 0.15,
  partClientsAvecPanier: 0.35,
  partCommandesInvite: 0.3,
  partCommandesUSD: 0.12,
  partCommandesAvecPromo: 0.3,
  partCommandesRecentes: 0.35,
  // Profondeur de l'historique, en jours.
  ancienneteMaxClient: 900,
  ancienneteMaxCommande: 540,
};

// Mot de passe en clair commun aux comptes de demonstration (donnees fictives).
const SEED_PASSWORD = 'Seed!Passw0rd';

// ---------------------------------------------------------------------------
// Outils deterministes
// ---------------------------------------------------------------------------

/** Generateur pseudo-aleatoire a graine (mulberry32) : reproductible. */
function prng(graine) {
  let a = graine >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rnd = prng(PARAMS.graine);
const entier = (min, max) => min + Math.floor(rnd() * (max - min + 1));
const tirer = (tableau) => tableau[Math.floor(rnd() * tableau.length)];
const chance = (p) => rnd() < p;
const arrondi2 = (n) => Math.round(n * 100) / 100;

function tirerPlusieurs(tableau, n) {
  const copie = tableau.slice();
  const sortie = [];
  for (let i = 0; i < n && copie.length; i += 1) {
    sortie.push(copie.splice(Math.floor(rnd() * copie.length), 1)[0]);
  }
  return sortie;
}

/** UUID v5-like deterministe : meme cle metier => meme identifiant. */
function uuid(key) {
  const h = crypto.createHash('sha1').update(`shop-seed:${key}`).digest();
  const b = Buffer.from(h.subarray(0, 16));
  b[6] = (b[6] & 0x0f) | 0x50;
  b[8] = (b[8] & 0x3f) | 0x80;
  const x = b.toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

/** Hash scrypt deterministe (sel derive de l'email) : jamais de mot de passe en clair. */
function hashPassword(plain, email) {
  const salt = crypto.createHash('sha256').update(email).digest().subarray(0, 16);
  const dk = crypto.scryptSync(plain, salt, 32);
  return `scrypt$16384$8$1$${salt.toString('hex')}$${dk.toString('hex')}`;
}

// Reference temporelle unique pour toute la generation.
const MAINTENANT = new Date();
MAINTENANT.setHours(12, 0, 0, 0);
const JOUR = 86400000;

/**
 * Date absolue a partir d'un decalage en jours (negatif = passe).
 *
 * Convention d'heures, pour que les comparaisons restent justes a la journee :
 *   - les bornes (inscription, debut de periode de prix, debut de promotion)
 *     sont posees a 00:00, donc tout evenement du meme jour tombe apres ;
 *   - les fins de promotion a 23:00, donc le dernier jour est inclus ;
 *   - les evenements (commandes) tirent une heure ouvrable.
 * Sans cette convention, une commande passee a 8h le jour d'un changement de
 * prix tomberait du mauvais cote de la borne.
 */
function jour(n, heure = 12) {
  const d = new Date(MAINTENANT.getTime() + n * JOUR);
  d.setHours(heure, 0, 0, 0);
  return d;
}

/** Nombre de jours entre deux dates (positif si b est posterieure a a). */
const ecartJours = (a, b) => Math.round((b.getTime() - a.getTime()) / JOUR);

// ---------------------------------------------------------------------------
// Vocabulaire du catalogue
// ---------------------------------------------------------------------------

const MARQUES = ['Aurora', 'Northwind', 'Belmont', 'Kervadec', 'Solveig', 'Tramontane'];

const ARBRE_CATEGORIES = [
  { cle: 'vetements', nom: 'Vetements', parent: null },
  { cle: 'chaussures', nom: 'Chaussures', parent: null },
  { cle: 'accessoires', nom: 'Accessoires', parent: null },
  { cle: 'tshirts', nom: 'T-shirts', parent: 'vetements' },
  { cle: 'vestes', nom: 'Vestes', parent: 'vetements' },
  { cle: 'pantalons', nom: 'Pantalons', parent: 'vetements' },
  { cle: 'baskets', nom: 'Baskets', parent: 'chaussures' },
  { cle: 'bottes', nom: 'Bottes', parent: 'chaussures' },
  { cle: 'sacs', nom: 'Sacs', parent: 'accessoires' },
  { cle: 'ceintures', nom: 'Ceintures', parent: 'accessoires' },
];

// Gabarits de produits par categorie feuille : nom, prix de depart, et mode de
// declinaison. C'est ce dernier point qui evite les declinaisons absurdes
// (une ceinture n'a pas de couleur de semelle, un sac n'a pas de taille S/M/L).
const GABARITS = {
  tshirts: {
    noms: ['T-shirt Coton Bio', 'T-shirt Raye', 'T-shirt Col V', 'Debardeur Leger'],
    prix: [18, 39], tailles: ['XS', 'S', 'M', 'L', 'XL'], couleurs: ['Blanc', 'Noir', 'Marine', 'Sable'],
  },
  vestes: {
    noms: ['Veste Impermeable', 'Veste Matelassee', 'Blouson Coupe-vent', 'Parka Doublee'],
    prix: [89, 249], tailles: ['S', 'M', 'L', 'XL'], couleurs: ['Noir', 'Kaki', 'Bleu'],
  },
  pantalons: {
    noms: ['Pantalon Chino', 'Jean Droit', 'Pantalon de Randonnee'],
    prix: [45, 129], tailles: ['38', '40', '42', '44', '46'], couleurs: ['Beige', 'Marine', 'Gris'],
  },
  baskets: {
    noms: ['Basket Runner', 'Basket Urbaine', 'Basket Trail'],
    prix: [69, 159], tailles: ['39', '40', '41', '42', '43', '44'], couleurs: ['Blanc', 'Noir'],
  },
  bottes: {
    noms: ['Botte Trek', 'Botte Chelsea', 'Botte Pluie'],
    prix: [95, 219], tailles: ['39', '41', '43', '45'], couleurs: ['Cuir', 'Noir'],
  },
  sacs: {
    noms: ['Sac a Dos 20L', 'Sac Besace', 'Sac de Voyage 45L'],
    prix: [49, 179], tailles: null, couleurs: ['Noir', 'Olive', 'Bordeaux'],
  },
  ceintures: {
    noms: ['Ceinture Cuir Pleine Fleur', 'Ceinture Tressee'],
    prix: [29, 79], tailles: ['85', '90', '95', '100'], couleurs: null,
  },
};

const CATEGORIES_FEUILLES = Object.keys(GABARITS);
const PARENT_DE = Object.fromEntries(ARBRE_CATEGORIES.map((c) => [c.cle, c.parent]));

const PRENOMS = ['Alice', 'Bruno', 'Chloe', 'Damien', 'Elise', 'Farid', 'Gaelle', 'Hugo', 'Ines', 'Julien',
  'Karim', 'Lucie', 'Marc', 'Nadia', 'Olivier', 'Pauline', 'Quentin', 'Rachida', 'Samuel', 'Theo',
  'Ulysse', 'Valerie', 'William', 'Xavier', 'Yasmine', 'Zoe', 'Amine', 'Beatrice', 'Cedric', 'Dorothee'];
const NOMS = ['Durand', 'Lefevre', 'Martin', 'Petit', 'Moreau', 'Benali', 'Rousseau', 'Garnier', 'Fontaine',
  'Lambert', 'Mercier', 'Blanchard', 'Perrin', 'Leroy', 'Girard', 'Bonnet', 'Chevalier', 'Masson',
  'Dumas', 'Carpentier'];

const VILLES = [
  { ville: 'Lyon', cp: '69003', pays: 'FR' },
  { ville: 'Paris', cp: '75011', pays: 'FR' },
  { ville: 'Toulouse', cp: '31000', pays: 'FR' },
  { ville: 'Nantes', cp: '44000', pays: 'FR' },
  { ville: 'Lille', cp: '59000', pays: 'FR' },
  { ville: 'Bordeaux', cp: '33000', pays: 'FR' },
  { ville: 'Strasbourg', cp: '67000', pays: 'FR' },
  { ville: 'Bruxelles', cp: '1000', pays: 'BE' },
  { ville: 'Liege', cp: '4000', pays: 'BE' },
  { ville: 'Geneve', cp: '1201', pays: 'CH' },
  { ville: 'Luxembourg', cp: '1111', pays: 'LU' },
];
const RUES = ['rue des Lilas', 'avenue Jean Jaures', 'boulevard Carnot', 'rue du Faubourg', 'place Bellecour',
  'impasse des Roses', 'chemin des Vignes', 'rue Victor Hugo', 'allee des Peupliers', 'quai de la Gare'];

const STATUTS = ['pending', 'paid', 'shipped', 'delivered', 'cancelled'];

// ---------------------------------------------------------------------------
// 1. Marques et categories
// ---------------------------------------------------------------------------

const marques = MARQUES.slice(0, PARAMS.marques).map((nom, i) => ({
  cle: `m${i}`,
  id: uuid(`brand:m${i}`),
  nom,
}));

const categories = ARBRE_CATEGORIES.map((c) => ({
  ...c,
  id: uuid(`category:${c.cle}`),
  parentId: c.parent ? uuid(`category:${c.parent}`) : null,
}));

// ---------------------------------------------------------------------------
// 2. Produits et declinaisons
// ---------------------------------------------------------------------------

const produits = [];
const variantes = [];

for (let i = 0; i < PARAMS.produits; i += 1) {
  const categorie = CATEGORIES_FEUILLES[i % CATEGORIES_FEUILLES.length];
  const gabarit = GABARITS[categorie];
  const marque = tirer(marques);
  const nom = `${tirer(gabarit.noms)} ${marque.nom}`;
  const cle = `p${i}`;
  const reference = `${marque.nom.slice(0, 3).toUpperCase()}-${categorie.slice(0, 2).toUpperCase()}-${String(i + 1).padStart(3, '0')}`;

  // Rattachement : toujours la categorie feuille, parfois aussi sa parente.
  const rattachements = [categorie];
  if (chance(0.35) && PARENT_DE[categorie]) rattachements.push(PARENT_DE[categorie]);

  const produit = {
    cle,
    id: uuid(`product:${cle}`),
    nom,
    description: `${nom}. Modele ${reference} de la collection ${marque.nom}, concu pour un usage quotidien.`,
    reference,
    marqueId: marque.id,
    categorie,
    rattachements,
    prixBase: entier(gabarit.prix[0], gabarit.prix[1]),
    lancement: -entier(200, PARAMS.ancienneteMaxCommande + 160),
  };
  produits.push(produit);

  // Declinaisons : la combinatoire depend du gabarit, pas du hasard pur.
  const tailles = gabarit.tailles ? tirerPlusieurs(gabarit.tailles, entier(1, Math.min(3, gabarit.tailles.length))) : [null];
  const couleurs = gabarit.couleurs ? tirerPlusieurs(gabarit.couleurs, entier(1, Math.min(2, gabarit.couleurs.length))) : [null];

  let n = 0;
  for (const taille of tailles) {
    for (const couleur of couleurs) {
      const cleVariante = `${cle}-v${n}`;
      variantes.push({
        cle: cleVariante,
        id: uuid(`variant:${cleVariante}`),
        produit,
        reference: `${reference}-${n + 1}`,
        taille,
        couleur,
      });
      n += 1;
    }
  }
}

// ---------------------------------------------------------------------------
// 3. Historique de prix
// ---------------------------------------------------------------------------
// Une declinaison a une suite de periodes contigues et sans chevauchement par
// devise : [lancement, c1), [c1, c2), [c2, +infini). Seule la derniere est
// ouverte. C'est cet historique qui fixera le prix unitaire des commandes.

const prix = [];
const indexPrix = new Map(); // `${cleVariante}|${devise}` -> [{debut, fin, montant}]

function genererPeriodes(variante, devise, facteur) {
  const lancement = variante.produit.lancement;
  const nb = entier(1, 3);
  const bornes = [lancement];
  let courant = lancement;
  for (let i = 1; i < nb; i += 1) {
    const min = courant + 45;
    if (min > -20) break;
    courant = entier(min, -20);
    bornes.push(courant);
  }

  let montant = arrondi2(variante.produit.prixBase * facteur);
  const periodes = [];
  for (let i = 0; i < bornes.length; i += 1) {
    if (i > 0) montant = Math.max(1, arrondi2(montant * (0.85 + rnd() * 0.4)));
    const debut = bornes[i];
    const fin = i < bornes.length - 1 ? bornes[i + 1] : null;
    periodes.push({ debut, fin, montant });
    prix.push({
      id: uuid(`price:${variante.cle}:${devise}:${debut}`),
      varianteId: variante.id,
      montant,
      debut: jour(debut, 0),
      fin: fin === null ? null : jour(fin, 0),
      devise,
    });
  }
  indexPrix.set(`${variante.cle}|${devise}`, periodes);
}

for (const variante of variantes) {
  genererPeriodes(variante, 'EUR', 1);
  // Une minorite de declinaisons est aussi tarifee en USD.
  if (chance(0.2)) genererPeriodes(variante, 'USD', 1.1);
}

/** Prix en vigueur pour une declinaison, une devise et un jour donne. */
function prixAu(variante, devise, jourRelatif) {
  const periodes = indexPrix.get(`${variante.cle}|${devise}`);
  if (!periodes) return null;
  for (const p of periodes) {
    if (jourRelatif >= p.debut && (p.fin === null || jourRelatif < p.fin)) return p.montant;
  }
  return null;
}

/** Declinaisons disposant d'un prix a cette date dans cette devise. */
function variantesDisponibles(devise, jourRelatif) {
  return variantes.filter((v) => prixAu(v, devise, jourRelatif) !== null);
}

// ---------------------------------------------------------------------------
// 4. Clients et adresses
// ---------------------------------------------------------------------------

const clients = [];
const adresses = [];
const emailsPris = new Set();

for (let i = 0; i < PARAMS.clients; i += 1) {
  const prenom = PRENOMS[i % PRENOMS.length];
  const nomFamille = NOMS[(i * 7) % NOMS.length];
  let email = `${prenom}.${nomFamille}`.toLowerCase().replace(/[^a-z.]/g, '') + '@example.com';
  if (emailsPris.has(email)) email = email.replace('@', `${i}@`);
  emailsPris.add(email);

  const cle = `c${i}`;
  const inscription = -entier(30, PARAMS.ancienneteMaxClient);
  const client = {
    cle,
    id: uuid(`user:${cle}`),
    nom: `${prenom} ${nomFamille}`,
    email,
    telephone: `+336${String(10000000 + i * 137).slice(0, 8)}`,
    inscription,
    // Derniere mise a jour du compte : entre l'inscription et aujourd'hui.
    majCompte: Math.min(0, inscription + entier(0, Math.abs(inscription))),
    actif: !chance(PARAMS.partClientsInactifs),
    adresses: [],
  };
  clients.push(client);

  // Une adresse de livraison par defaut, parfois une adresse de facturation.
  const lieu = tirer(VILLES);
  const livraison = {
    id: uuid(`address:${cle}:ship`),
    clientId: client.id,
    type: 'shipping',
    rue: `${entier(1, 120)} ${tirer(RUES)}`,
    ville: lieu.ville,
    cp: lieu.cp,
    pays: lieu.pays,
    defaut: true,
  };
  adresses.push(livraison);
  client.adresses.push(livraison);

  if (chance(0.45)) {
    const autre = tirer(VILLES);
    const facturation = {
      id: uuid(`address:${cle}:bill`),
      clientId: client.id,
      type: 'billing',
      rue: `${entier(1, 120)} ${tirer(RUES)}`,
      ville: autre.ville,
      cp: autre.cp,
      pays: autre.pays,
      // Au plus une adresse par defaut par type : celle-ci est la seule
      // de type billing, elle peut donc l'etre.
      defaut: true,
    };
    adresses.push(facturation);
    client.adresses.push(facturation);
  }
}

// Garantit des cas explicites, meme si le tirage ne les a pas produits.
clients[0].actif = true;
clients[1].actif = true;
clients[2].actif = false;
clients[3].actif = false;

// ---------------------------------------------------------------------------
// 5. Paniers
// ---------------------------------------------------------------------------
// Cart.userId est UNIQUE : un panier au plus par client. Un panier ne contient
// que des declinaisons actuellement tarifees.

const paniers = [];
const lignesPanier = [];
const disponiblesAujourdhui = variantesDisponibles('EUR', 0);

for (const client of clients) {
  if (!client.actif) continue;
  if (!chance(PARAMS.partClientsAvecPanier)) continue;

  const creation = Math.max(client.inscription, -entier(1, 45));
  const panier = {
    id: uuid(`cart:${client.cle}`),
    clientId: client.id,
    creation,
    maj: Math.min(0, creation + entier(0, Math.abs(creation))),
  };
  paniers.push(panier);

  // Deux paniers vides sont conserves volontairement : un panier cree puis
  // abandonne est un etat parfaitement legitime.
  if (paniers.length > 2 && chance(0.85)) {
    for (const variante of tirerPlusieurs(disponiblesAujourdhui, entier(1, 4))) {
      lignesPanier.push({
        id: uuid(`cartitem:${client.cle}:${variante.cle}`),
        panierId: panier.id,
        varianteId: variante.id,
        quantite: entier(1, 3),
      });
    }
  }
}

// ---------------------------------------------------------------------------
// 6. Promotions
// ---------------------------------------------------------------------------

const promotions = [];
const ciblesPromotion = [];

const MODELES_PROMO = [
  { code: 'WELCOME10', type: 'percentage', valeur: 10, portee: 'cart', debut: -200, fin: 60, maxUses: 500, maxParClient: 1 },
  { code: 'MINUS5', type: 'fixed', valeur: 5, portee: 'cart', debut: -150, fin: 40, maxUses: null, maxParClient: null },
  { code: 'TSHIRT20', type: 'percentage', valeur: 20, portee: 'product', debut: -120, fin: 30, maxUses: 300, maxParClient: 2 },
  { code: 'VESTE10', type: 'fixed', valeur: 10, portee: 'product', debut: -90, fin: 25, maxUses: null, maxParClient: null },
  { code: 'CHAUSSURES15', type: 'fixed', valeur: 15, portee: 'category', debut: -180, fin: 20, maxUses: null, maxParClient: null },
  { code: 'HIVER30', type: 'percentage', valeur: 30, portee: 'category', debut: -60, fin: 35, maxUses: 200, maxParClient: 1 },
  { code: 'FIDELITE25', type: 'percentage', valeur: 25, portee: 'cart', debut: -300, fin: 90, maxUses: 1, maxParClient: 1, nominative: 0 },
  { code: 'PARRAINAGE10', type: 'fixed', valeur: 10, portee: 'cart', debut: -250, fin: 70, maxUses: 1, maxParClient: 1, nominative: 1 },
  { code: 'ETE26', type: 'percentage', valeur: 15, portee: 'cart', debut: -420, fin: -360, maxUses: null, maxParClient: null },
  { code: 'PRINTEMPS26', type: 'fixed', valeur: 8, portee: 'cart', debut: -520, fin: -470, maxUses: null, maxParClient: null },
  { code: 'BLACKFRIDAY', type: 'percentage', valeur: 40, portee: 'cart', debut: 7, fin: 12, maxUses: 1000, maxParClient: 1 },
  { code: 'NOEL', type: 'fixed', valeur: 20, portee: 'cart', debut: 30, fin: 48, maxUses: null, maxParClient: null },
];

for (const modele of MODELES_PROMO.slice(0, PARAMS.promotions)) {
  const cle = modele.code.toLowerCase();
  const promo = {
    cle,
    id: uuid(`promotion:${cle}`),
    code: modele.code,
    type: modele.type,
    valeur: modele.valeur,
    portee: modele.portee,
    debut: modele.debut,
    fin: modele.fin,
    maxUses: modele.maxUses,
    maxParClient: modele.maxParClient,
    clientId: modele.nominative === undefined ? null : clients[modele.nominative].id,
    clientCle: modele.nominative === undefined ? null : clients[modele.nominative].cle,
    produitsCibles: [],
    categoriesCibles: [],
    usages: 0,
    usagesParClient: new Map(),
  };

  // Une cible et une seule par ligne : un produit OU une categorie.
  if (promo.portee === 'product') {
    for (const produit of tirerPlusieurs(produits, 2)) {
      promo.produitsCibles.push(produit);
      ciblesPromotion.push({ promotionId: promo.id, produitId: produit.id, categorieId: null });
    }
  } else if (promo.portee === 'category') {
    const feuille = tirer(CATEGORIES_FEUILLES);
    const categorie = categories.find((c) => c.cle === feuille);
    promo.categoriesCibles.push(categorie);
    ciblesPromotion.push({ promotionId: promo.id, produitId: null, categorieId: categorie.id });
  }

  promotions.push(promo);
}

/** La promotion peut-elle s'appliquer a cette commande ? */
function promotionApplicable(promo, commande) {
  // Fenetre de validite : la commande doit tomber dedans.
  if (commande.date < promo.debut || commande.date > promo.fin) return false;
  // Quota global et quota par client.
  if (promo.maxUses !== null && promo.usages >= promo.maxUses) return false;
  // Promotion nominative : reservee a son titulaire, donc jamais a un invite.
  if (promo.clientId !== null) {
    if (commande.clientId !== promo.clientId) return false;
  }
  if (promo.maxParClient !== null && commande.clientId !== null) {
    if ((promo.usagesParClient.get(commande.clientId) || 0) >= promo.maxParClient) return false;
  }
  // Portee produit ou categorie : la commande doit contenir un article concerne.
  if (promo.portee === 'product') {
    const cibles = new Set(promo.produitsCibles.map((p) => p.cle));
    return commande.lignes.some((l) => cibles.has(l.variante.produit.cle));
  }
  if (promo.portee === 'category') {
    const cibles = new Set(promo.categoriesCibles.map((c) => c.cle));
    return commande.lignes.some((l) => l.variante.produit.rattachements.some((r) => cibles.has(r)));
  }
  return true;
}

// ---------------------------------------------------------------------------
// 7. Commandes
// ---------------------------------------------------------------------------
// Chaque commande est datee, puis tout le reste en decoule :
//   - les articles doivent avoir un prix publie a cette date dans la devise,
//   - le prix unitaire est celui de l'historique, pas un prix invente,
//   - le statut est compatible avec l'anciennete (une commande d'hier ne peut
//     pas etre deja livree, une commande d'il y a un an ne reste pas "pending"),
//   - un client ne peut pas commander avant son inscription.

const commandes = [];
let compteurCommande = 0;

/** Statut plausible compte tenu de l'age de la commande, en jours. */
function statutSelonAge(age) {
  if (chance(0.06)) return 'cancelled';
  if (age <= 1) return chance(0.65) ? 'pending' : 'paid';
  if (age <= 4) return chance(0.5) ? 'paid' : 'shipped';
  if (age <= 14) return chance(0.35) ? 'shipped' : 'delivered';
  return 'delivered';
}

while (commandes.length < PARAMS.commandes) {
  // Un tiers des commandes sur le mois ecoule, le reste reparti sur toute la
  // periode : sans ce biais, presque tout serait ancien donc "delivered", et
  // le cycle de vie d'une commande ne serait pas represente.
  const jourCommande = chance(PARAMS.partCommandesRecentes)
    ? -entier(0, 30)
    : -entier(0, PARAMS.ancienneteMaxCommande);
  const age = -jourCommande;
  const devise = chance(PARAMS.partCommandesUSD) ? 'USD' : 'EUR';

  const candidates = variantesDisponibles(devise, jourCommande);
  if (candidates.length === 0) continue;

  // Client identifie deja inscrit a cette date, sinon commande invite.
  let client = null;
  if (!chance(PARAMS.partCommandesInvite)) {
    const eligibles = clients.filter((c) => c.inscription <= jourCommande);
    if (eligibles.length === 0) continue;
    client = tirer(eligibles);
  }

  const lignesVariantes = tirerPlusieurs(candidates, entier(1, 4));
  const lignes = lignesVariantes.map((variante) => ({
    variante,
    quantite: entier(1, 3),
    prixUnitaire: prixAu(variante, devise, jourCommande),
  }));

  compteurCommande += 1;
  const dateCommande = jour(jourCommande, entier(8, 20));
  const annee = dateCommande.getFullYear();

  // Adresse de livraison : celle du client, ou une adresse saisie par l'invite.
  let livraison;
  let invite = null;
  if (client) {
    const adresse = client.adresses.find((a) => a.type === 'shipping') || client.adresses[0];
    livraison = { rue: adresse.rue, ville: adresse.ville, cp: adresse.cp, pays: adresse.pays };
  } else {
    const lieu = tirer(VILLES);
    const prenom = tirer(PRENOMS);
    const nomFamille = tirer(NOMS);
    livraison = { rue: `${entier(1, 120)} ${tirer(RUES)}`, ville: lieu.ville, cp: lieu.cp, pays: lieu.pays };
    invite = {
      nom: `${prenom} ${nomFamille}`,
      email: `${prenom}.${nomFamille}`.toLowerCase() + `.${compteurCommande}@example.com`,
      telephone: `+336${String(20000000 + compteurCommande * 311).slice(0, 8)}`,
    };
  }

  const commande = {
    cle: `o${compteurCommande}`,
    id: uuid(`order:o${compteurCommande}`),
    numero: `ORD-${annee}-${String(compteurCommande).padStart(4, '0')}`,
    date: jourCommande,
    dateAbsolue: dateCommande,
    statut: statutSelonAge(age),
    devise,
    clientId: client ? client.id : null,
    clientCle: client ? client.cle : null,
    invite,
    livraison,
    lignes,
    promotionId: null,
  };

  // Promotion : seulement parmi celles reellement applicables a cette commande.
  if (chance(PARAMS.partCommandesAvecPromo)) {
    const applicables = promotions.filter((p) => promotionApplicable(p, commande));
    if (applicables.length) {
      const promo = tirer(applicables);
      commande.promotionId = promo.id;
      promo.usages += 1;
      if (commande.clientId) {
        promo.usagesParClient.set(commande.clientId, (promo.usagesParClient.get(commande.clientId) || 0) + 1);
      }
    }
  }

  commandes.push(commande);
}

// Filet de securite : garantit au moins deux commandes de chaque statut, meme
// si le tirage n'en a pas produit. Une commande n'est redatee que si tout reste
// coherent apres le changement (prix publies, date d'inscription du client).
const AGE_CIBLE = { pending: 0, paid: 3, shipped: 8, delivered: 60, cancelled: 30 };

for (const statut of STATUTS) {
  let presentes = commandes.filter((c) => c.statut === statut).length;
  if (presentes >= 2) continue;
  const ageCible = AGE_CIBLE[statut];
  const nouvelleDate = -ageCible;

  for (const c of commandes) {
    if (presentes >= 2) break;
    if (c.statut === statut) continue;
    // Ne pas vider un statut qui est lui-meme a la limite.
    if (commandes.filter((x) => x.statut === c.statut).length <= 2) continue;
    // Le client doit deja etre inscrit a la nouvelle date.
    if (c.clientId !== null) {
      const client = clients.find((x) => x.id === c.clientId);
      if (client.inscription > nouvelleDate) continue;
    }
    // Les articles doivent avoir un prix publie a la nouvelle date.
    const lignes = c.lignes
      .map((l) => ({ ...l, prixUnitaire: prixAu(l.variante, c.devise, nouvelleDate) }))
      .filter((l) => l.prixUnitaire !== null);
    if (lignes.length === 0) continue;

    c.statut = statut;
    c.date = nouvelleDate;
    c.dateAbsolue = jour(nouvelleDate, 14);
    c.numero = `ORD-${c.dateAbsolue.getFullYear()}-${c.numero.slice(-4)}`;
    c.lignes = lignes;
    // La promotion n'est peut-etre plus dans sa fenetre de validite.
    if (c.promotionId) {
      const promo = promotions.find((p) => p.id === c.promotionId);
      if (!promo || c.date < promo.debut || c.date > promo.fin) c.promotionId = null;
    }
    presentes += 1;
  }
}

// Une commande sans ligne n'a pas de sens : on l'ecarte.
const commandesValides = commandes.filter((c) => c.lignes.length > 0);

// ---------------------------------------------------------------------------
// Assemblage des lignes a inserer
// ---------------------------------------------------------------------------

function buildRows() {
  const rows = {};

  rows.Brand = marques.map((m) => [m.id, m.nom]);

  rows.Category = categories.map((c) => [c.id, c.nom, c.parentId]);

  rows.Product = produits.map((p) => [p.id, p.nom, p.description, p.reference, p.marqueId]);

  rows.ProductCategory = produits.flatMap((p) =>
    p.rattachements.map((cle) => [p.id, uuid(`category:${cle}`)])
  );

  rows.ProductVariant = variantes.map((v) => [v.id, v.produit.id, v.reference, v.taille, v.couleur]);

  rows.PriceHistory = prix.map((p) => [p.id, p.varianteId, p.montant, p.debut, p.fin, p.devise]);

  rows.User = clients.map((c) => [
    c.id,
    c.nom,
    c.email,
    hashPassword(SEED_PASSWORD, c.email),
    c.telephone,
    jour(c.inscription, 0),
    jour(c.majCompte, 0),
    c.actif,
  ]);

  rows.Address = adresses.map((a) => [a.id, a.clientId, a.type, a.rue, a.ville, a.cp, a.pays, a.defaut]);

  rows.Cart = paniers.map((p) => [p.id, p.clientId, jour(p.creation, 0), jour(p.maj, 0)]);

  rows.CartItem = lignesPanier.map((l) => [l.id, l.panierId, l.varianteId, l.quantite]);

  rows.Promotion = promotions.map((p) => [
    p.id, p.code, p.type, p.valeur, p.portee, jour(p.debut, 0), jour(p.fin, 23),
    p.maxUses, p.clientId, p.maxParClient,
  ]);

  rows.PromotionTarget = ciblesPromotion.map((t) => [t.promotionId, t.produitId, t.categorieId]);

  rows.Order = commandesValides.map((c) => [
    c.id,
    c.clientId,
    c.numero,
    c.dateAbsolue,
    c.statut,
    c.devise,
    c.invite ? c.invite.nom : null,
    c.invite ? c.invite.email : null,
    c.invite ? c.invite.telephone : null,
    c.livraison.rue,
    c.livraison.ville,
    c.livraison.cp,
    c.livraison.pays,
    c.promotionId,
  ]);

  rows.OrderItem = commandesValides.flatMap((c) =>
    c.lignes.map((l) => [
      uuid(`orderitem:${c.cle}:${l.variante.cle}`),
      c.id,
      l.variante.id,
      l.quantite,
      l.prixUnitaire,
    ])
  );

  return rows;
}

// Ordre d'insertion : respecte les dependances de cles etrangeres.
const INSERT_ORDER = [
  ['Brand', ['id', 'name']],
  ['Category', ['id', 'name', 'parentId']],
  ['Product', ['id', 'name', 'description', 'reference', 'brandId']],
  ['ProductCategory', ['productId', 'categoryId']],
  ['ProductVariant', ['id', 'productId', 'reference', 'size', 'color']],
  ['PriceHistory', ['id', 'productVariantId', 'price', 'startDate', 'endDate', 'currency']],
  ['User', ['id', 'name', 'email', 'password', 'phoneNumber', 'createdAt', 'updatedAt', 'isActive']],
  ['Address', ['id', 'uid', 'type', 'street', 'city', 'postalCode', 'country', 'isDefault']],
  ['Cart', ['id', 'userId', 'createdAt', 'updatedAt']],
  ['CartItem', ['id', 'cartId', 'productVariantId', 'quantity']],
  ['Promotion', ['id', 'code', 'discountType', 'discountValue', 'scope', 'startDate', 'endDate', 'maxUses', 'userId', 'maxUsesPerUser']],
  ['PromotionTarget', ['promotionId', 'productId', 'categoryId']],
  ['Order', ['id', 'userId', 'orderNumber', 'orderDate', 'status', 'currency', 'guestName', 'guestEmail', 'guestPhoneNumber', 'shippingStreet', 'shippingCity', 'shippingPostalCode', 'shippingCountry', 'promotionId']],
  ['OrderItem', ['id', 'orderId', 'productVariantId', 'quantity', 'unitPrice']],
];

// ---------------------------------------------------------------------------
// Garde-fou : rien n'est insere si une seule invariante est violee
// ---------------------------------------------------------------------------

function verifierCoherence() {
  const erreurs = [];
  const ajout = (c) => erreurs.push(c);

  // --- Unicites ------------------------------------------------------------
  const doublons = (liste, libelle) => {
    const vus = new Set();
    for (const v of liste) {
      if (vus.has(v)) ajout(`${libelle} : doublon ${v}`);
      vus.add(v);
    }
  };
  doublons(clients.map((c) => c.email), 'User.email');
  doublons(produits.map((p) => p.reference), 'Product.reference');
  doublons(variantes.map((v) => v.reference), 'ProductVariant.reference');
  doublons(commandesValides.map((c) => c.numero), 'Order.orderNumber');
  doublons(paniers.map((p) => p.clientId), 'Cart.userId');
  doublons(promotions.map((p) => p.code), 'Promotion.code');
  doublons(lignesPanier.map((l) => `${l.panierId}|${l.varianteId}`), 'CartItem (panier, declinaison)');
  doublons(
    commandesValides.flatMap((c) => c.lignes.map((l) => `${c.id}|${l.variante.id}`)),
    'OrderItem (commande, declinaison)'
  );
  doublons(
    adresses.filter((a) => a.defaut).map((a) => `${a.clientId}|${a.type}`),
    'Address : deux adresses par defaut du meme type'
  );

  // --- Historique de prix --------------------------------------------------
  for (const [cle, periodes] of indexPrix) {
    const triees = periodes.slice().sort((a, b) => a.debut - b.debut);
    for (let i = 0; i < triees.length; i += 1) {
      const p = triees[i];
      if (p.fin !== null && p.fin <= p.debut) ajout(`PriceHistory ${cle} : fin anterieure au debut`);
      if (p.montant <= 0) ajout(`PriceHistory ${cle} : prix non positif`);
      if (i < triees.length - 1 && triees[i].fin !== triees[i + 1].debut) {
        ajout(`PriceHistory ${cle} : periodes non contigues ou qui se chevauchent`);
      }
    }
    if (triees[triees.length - 1].fin !== null) ajout(`PriceHistory ${cle} : aucun prix courant`);
  }

  // --- Clients et paniers --------------------------------------------------
  for (const c of clients) {
    if (c.majCompte < c.inscription) ajout(`User ${c.email} : mise a jour anterieure a l'inscription`);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c.email)) ajout(`User ${c.email} : email mal forme`);
  }
  const parClient = new Map(clients.map((c) => [c.id, c]));
  for (const p of paniers) {
    const c = parClient.get(p.clientId);
    if (p.creation < c.inscription) ajout(`Cart ${c.email} : panier anterieur a l'inscription`);
    if (p.maj < p.creation) ajout(`Cart ${c.email} : mise a jour anterieure a la creation`);
  }
  for (const l of lignesPanier) {
    if (l.quantite <= 0) ajout('CartItem : quantite non positive');
  }

  // --- Commandes -----------------------------------------------------------
  const bornesStatut = { pending: [0, 7], paid: [0, 45], shipped: [1, 400], delivered: [2, 999], cancelled: [0, 999] };
  for (const c of commandesValides) {
    const age = -c.date;

    if (c.clientId === null && !c.invite) ajout(`${c.numero} : ni client ni invite`);
    if (c.clientId !== null && c.invite) ajout(`${c.numero} : client identifie ET invite`);

    if (c.clientId !== null) {
      const client = parClient.get(c.clientId);
      if (c.date < client.inscription) ajout(`${c.numero} : commande anterieure a l'inscription du client`);
    }

    const [min, max] = bornesStatut[c.statut];
    if (age < min || age > max) ajout(`${c.numero} : statut ${c.statut} incompatible avec un age de ${age} jours`);

    if (c.lignes.length === 0) ajout(`${c.numero} : commande sans ligne`);
    for (const l of c.lignes) {
      if (l.quantite <= 0) ajout(`${c.numero} : quantite non positive`);
      const attendu = prixAu(l.variante, c.devise, c.date);
      if (attendu === null) ajout(`${c.numero} : ${l.variante.reference} n'avait pas de prix en ${c.devise} a cette date`);
      else if (Math.abs(attendu - l.prixUnitaire) > 0.001) {
        ajout(`${c.numero} : prix unitaire ${l.prixUnitaire} alors que l'historique dit ${attendu}`);
      }
    }

    if (c.promotionId) {
      const promo = promotions.find((p) => p.id === c.promotionId);
      if (!promo) ajout(`${c.numero} : promotion inconnue`);
      else {
        if (c.date < promo.debut || c.date > promo.fin) {
          ajout(`${c.numero} : promotion ${promo.code} hors de sa periode de validite`);
        }
        if (promo.clientId !== null && promo.clientId !== c.clientId) {
          ajout(`${c.numero} : promotion nominative ${promo.code} utilisee par quelqu'un d'autre`);
        }
      }
    }
  }

  // Quotas d'utilisation des promotions.
  for (const promo of promotions) {
    const usages = commandesValides.filter((c) => c.promotionId === promo.id);
    if (promo.maxUses !== null && usages.length > promo.maxUses) {
      ajout(`Promotion ${promo.code} : ${usages.length} utilisations pour un maximum de ${promo.maxUses}`);
    }
    if (promo.maxParClient !== null) {
      const parPersonne = new Map();
      for (const c of usages.filter((u) => u.clientId)) {
        parPersonne.set(c.clientId, (parPersonne.get(c.clientId) || 0) + 1);
      }
      for (const [, n] of parPersonne) {
        if (n > promo.maxParClient) ajout(`Promotion ${promo.code} : quota par client depasse`);
      }
    }
    if (promo.fin <= promo.debut) ajout(`Promotion ${promo.code} : fin anterieure au debut`);
    if (promo.type === 'percentage' && promo.valeur > 100) ajout(`Promotion ${promo.code} : pourcentage superieur a 100`);
  }

  // --- Cibles de promotion -------------------------------------------------
  for (const t of ciblesPromotion) {
    const n = (t.produitId ? 1 : 0) + (t.categorieId ? 1 : 0);
    if (n !== 1) ajout('PromotionTarget : une cible et une seule est attendue');
  }

  return erreurs;
}

/** Repartition des donnees generees, pour l'affichage en fin de seed. */
function resume() {
  const parStatut = {};
  for (const c of commandesValides) parStatut[c.statut] = (parStatut[c.statut] || 0) + 1;
  return {
    clients: clients.length,
    clientsActifs: clients.filter((c) => c.actif).length,
    produits: produits.length,
    declinaisons: variantes.length,
    lignesDePrix: prix.length,
    prixClotures: prix.filter((p) => p.fin !== null).length,
    paniers: paniers.length,
    paniersVides: paniers.length - new Set(lignesPanier.map((l) => l.panierId)).size,
    promotions: promotions.length,
    commandes: commandesValides.length,
    commandesInvite: commandesValides.filter((c) => c.clientId === null).length,
    commandesAvecPromo: commandesValides.filter((c) => c.promotionId !== null).length,
    parStatut,
  };
}

const COMPTES_DEMO = clients.slice(0, 3).map((c) => c.email);

module.exports = {
  buildRows,
  INSERT_ORDER,
  uuid,
  jour,
  hashPassword,
  verifierCoherence,
  resume,
  COMPTES_DEMO,
  SEED_PASSWORD,
  PARAMS,
};
