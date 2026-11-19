'use strict';

/**
 * Complement de donnees : 5 lignes par table, a AJOUTER a un jeu deja en place.
 *
 * Contrairement a data.js, qui genere un jeu complet de maniere aleatoire mais
 * deterministe, ce fichier est ecrit a la main : 5 lignes par table se lisent
 * et se verifient directement.
 *
 * Deux regles de construction :
 *   1. Toutes les cles metier sont prefixees "ext:", donc les UUID produits ne
 *      peuvent pas entrer en collision avec ceux du jeu principal.
 *   2. Les nouvelles lignes ne referencent que des nouvelles lignes, sauf pour
 *      les categories parentes, qui existent deja. Rien ne depend donc de
 *      l'etat exact du jeu principal, et rien ne le modifie.
 *
 * Rappel : ce modele n'a ni table de paiement, ni de livraison, ni de stock.
 * Le statut de commande reste le seul porteur du cycle paiement / expedition.
 */

const { uuid, jour, hashPassword, SEED_PASSWORD } = require('./data');

/** Identifiant d'une ligne de complement. */
const ID = (cle) => uuid(`ext:${cle}`);
/** Identifiant d'une ligne du jeu principal (categories parentes existantes). */
const IDPrincipal = (cle) => uuid(cle);

// ---------------------------------------------------------------------------
// 1. Marques
// ---------------------------------------------------------------------------

const MARQUES = [
  { cle: 'marque-vermillon', nom: 'Vermillon' },
  { cle: 'marque-halvard', nom: 'Halvard' },
  { cle: 'marque-castelane', nom: 'Castelane' },
  { cle: 'marque-ombeline', nom: 'Ombeline' },
  { cle: 'marque-rivages', nom: 'Rivages' },
];

// ---------------------------------------------------------------------------
// 2. Categories (toutes rattachees a une racine existante)
// ---------------------------------------------------------------------------

const CATEGORIES = [
  { cle: 'cat-echarpes', nom: 'Echarpes', parent: 'category:accessoires' },
  { cle: 'cat-bonnets', nom: 'Bonnets', parent: 'category:accessoires' },
  { cle: 'cat-chaussettes', nom: 'Chaussettes', parent: 'category:vetements' },
  { cle: 'cat-maillots', nom: 'Maillots', parent: 'category:vetements' },
  { cle: 'cat-sandales', nom: 'Sandales', parent: 'category:chaussures' },
];

// ---------------------------------------------------------------------------
// 3. Produits, declinaisons et prix
// ---------------------------------------------------------------------------
// Chaque produit : une marque, une categorie, une declinaison, un prix courant.
// Mise en vente il y a 90 jours, donc anterieure a toutes les commandes ci-dessous.

const MISE_EN_VENTE = -90;

const PRODUITS = [
  {
    cle: 'prod-echarpe', marque: 'marque-vermillon', categorie: 'cat-echarpes',
    nom: 'Echarpe Laine Merinos Vermillon', reference: 'EXT-EC-001',
    description: 'Echarpe en laine merinos, tricot cotele, 180 x 30 cm.',
    taille: null, couleur: 'Bordeaux', prix: 49.9,
  },
  {
    cle: 'prod-bonnet', marque: 'marque-halvard', categorie: 'cat-bonnets',
    nom: 'Bonnet Cotele Halvard', reference: 'EXT-BO-002',
    description: 'Bonnet cotele double epaisseur, revers ajustable.',
    taille: null, couleur: 'Marine', prix: 24.5,
  },
  {
    cle: 'prod-chaussettes', marque: 'marque-castelane', categorie: 'cat-chaussettes',
    nom: 'Chaussettes Coton Peigne Castelane', reference: 'EXT-CH-003',
    description: 'Lot de trois paires en coton peigne, couture plate.',
    taille: '41-43', couleur: 'Gris', prix: 18.0,
  },
  {
    cle: 'prod-maillot', marque: 'marque-ombeline', categorie: 'cat-maillots',
    nom: 'Maillot Technique Ombeline', reference: 'EXT-MA-004',
    description: 'Maillot technique respirant, coutures plates, sechage rapide.',
    taille: 'M', couleur: null, prix: 39.0,
  },
  {
    cle: 'prod-sandale', marque: 'marque-rivages', categorie: 'cat-sandales',
    nom: 'Sandale Cuir Rivages', reference: 'EXT-SA-005',
    description: 'Sandale en cuir tanne vegetal, semelle crepe, double bride.',
    taille: '42', couleur: 'Naturel', prix: 79.0,
  },
];

// ---------------------------------------------------------------------------
// 4. Clients, adresses et paniers
// ---------------------------------------------------------------------------
// Inscription il y a 120 jours : anterieure a leurs paniers et a leurs commandes.

const INSCRIPTION = -120;

const CLIENTS = [
  { cle: 'client-noemie', nom: 'Noemie Delacroix', email: 'noemie.delacroix.ext@example.com', tel: '+33611000001', actif: true, ville: 'Rennes', cp: '35000', pays: 'FR', rue: '14 rue de Saint-Malo' },
  { cle: 'client-tarek', nom: 'Tarek Haddad', email: 'tarek.haddad.ext@example.com', tel: '+33611000002', actif: true, ville: 'Montpellier', cp: '34000', pays: 'FR', rue: '7 place de la Comedie' },
  { cle: 'client-sonia', nom: 'Sonia Ferreira', email: 'sonia.ferreira.ext@example.com', tel: '+33611000003', actif: true, ville: 'Anvers', cp: '2000', pays: 'BE', rue: '22 Meir' },
  { cle: 'client-matthias', nom: 'Matthias Keller', email: 'matthias.keller.ext@example.com', tel: '+33611000004', actif: false, ville: 'Zurich', cp: '8001', pays: 'CH', rue: '5 Bahnhofstrasse' },
  { cle: 'client-awa', nom: 'Awa Diallo', email: 'awa.diallo.ext@example.com', tel: '+33611000005', actif: true, ville: 'Rouen', cp: '76000', pays: 'FR', rue: '31 rue du Gros-Horloge' },
];

// Un panier par client (Cart.userId est UNIQUE), un article dans chacun.
const PANIERS = [
  { client: 'client-noemie', creation: -10, maj: -2, produit: 'prod-echarpe', quantite: 1 },
  { client: 'client-tarek', creation: -8, maj: -8, produit: 'prod-bonnet', quantite: 2 },
  { client: 'client-sonia', creation: -6, maj: -1, produit: 'prod-chaussettes', quantite: 3 },
  { client: 'client-matthias', creation: -30, maj: -30, produit: 'prod-maillot', quantite: 1 },
  { client: 'client-awa', creation: -3, maj: 0, produit: 'prod-sandale', quantite: 1 },
];

// ---------------------------------------------------------------------------
// 5. Promotions et cibles
// ---------------------------------------------------------------------------

const PROMOTIONS = [
  {
    cle: 'promo-accueil5', code: 'EXT-ACCUEIL5', type: 'fixed', valeur: 5,
    portee: 'cart', debut: -30, fin: 60, maxUses: null, maxParClient: null, client: null,
  },
  {
    cle: 'promo-nouveaute15', code: 'EXT-NOUVEAUTE15', type: 'percentage', valeur: 15,
    portee: 'product', debut: -30, fin: 60, maxUses: 200, maxParClient: 2, client: null,
  },
  {
    cle: 'promo-accessoires10', code: 'EXT-ACCESSOIRES10', type: 'fixed', valeur: 10,
    portee: 'category', debut: -30, fin: 60, maxUses: null, maxParClient: null, client: null,
  },
  {
    cle: 'promo-hiver20', code: 'EXT-HIVER20', type: 'percentage', valeur: 20,
    portee: 'category', debut: -30, fin: 60, maxUses: 150, maxParClient: 1, client: null,
  },
  {
    // Promotion nominative : reservee a une cliente, donc jamais utilisable par un invite.
    cle: 'promo-vip30', code: 'EXT-VIP30', type: 'percentage', valeur: 30,
    portee: 'cart', debut: -30, fin: 60, maxUses: 1, maxParClient: 1, client: 'client-noemie',
  },
];

// Exactement une cible par ligne : un produit OU une categorie, jamais les deux.
// Une promotion peut en revanche viser plusieurs cibles.
const CIBLES = [
  { promotion: 'promo-nouveaute15', produit: 'prod-echarpe', categorie: null },
  { promotion: 'promo-nouveaute15', produit: 'prod-bonnet', categorie: null },
  { promotion: 'promo-accessoires10', produit: null, categorie: 'cat-echarpes' },
  { promotion: 'promo-accessoires10', produit: null, categorie: 'cat-bonnets' },
  { promotion: 'promo-hiver20', produit: null, categorie: 'cat-chaussettes' },
];

// ---------------------------------------------------------------------------
// 6. Commandes
// ---------------------------------------------------------------------------
// Une commande par statut. L'age est compatible avec le statut : une commande
// du jour ne peut pas etre livree, une commande de trois semaines ne reste pas
// en attente. Le prix unitaire reprend le prix courant du produit, qui est en
// vigueur depuis 90 jours donc valable a toutes ces dates.

const COMMANDES = [
  {
    cle: 'cmd-1', numero: 'ORD-2026-9001', age: 0, statut: 'pending',
    client: 'client-noemie', invite: null, promotion: null,
    produit: 'prod-echarpe', quantite: 1,
  },
  {
    cle: 'cmd-2', numero: 'ORD-2026-9002', age: 3, statut: 'paid',
    client: 'client-tarek', invite: null, promotion: 'promo-nouveaute15',
    produit: 'prod-bonnet', quantite: 2,
  },
  {
    cle: 'cmd-3', numero: 'ORD-2026-9003', age: 8, statut: 'shipped',
    client: null,
    invite: { nom: 'Lucas Brevet', email: 'lucas.brevet.ext@example.com', tel: '+33611000006' },
    promotion: null, produit: 'prod-chaussettes', quantite: 1,
    livraison: { rue: '3 rue des Carmes', ville: 'Orleans', cp: '45000', pays: 'FR' },
  },
  {
    cle: 'cmd-4', numero: 'ORD-2026-9004', age: 25, statut: 'delivered',
    client: 'client-sonia', invite: null, promotion: null,
    produit: 'prod-maillot', quantite: 1,
  },
  {
    cle: 'cmd-5', numero: 'ORD-2026-9005', age: 12, statut: 'cancelled',
    client: null,
    invite: { nom: 'Marion Vasseur', email: 'marion.vasseur.ext@example.com', tel: '+33611000007' },
    promotion: null, produit: 'prod-sandale', quantite: 1,
    livraison: { rue: '18 quai de la Fosse', ville: 'Nantes', cp: '44000', pays: 'FR' },
  },
];

// ---------------------------------------------------------------------------
// Assemblage
// ---------------------------------------------------------------------------

const produitParCle = Object.fromEntries(PRODUITS.map((p) => [p.cle, p]));
const clientParCle = Object.fromEntries(CLIENTS.map((c) => [c.cle, c]));
const promoParCle = Object.fromEntries(PROMOTIONS.map((p) => [p.cle, p]));

function buildExtraRows() {
  const rows = {};

  rows.Brand = MARQUES.map((m) => [ID(m.cle), m.nom]);

  rows.Category = CATEGORIES.map((c) => [ID(c.cle), c.nom, IDPrincipal(c.parent)]);

  rows.Product = PRODUITS.map((p) => [
    ID(p.cle), p.nom, p.description, p.reference, ID(p.marque),
  ]);

  rows.ProductCategory = PRODUITS.map((p) => [ID(p.cle), ID(p.categorie)]);

  rows.ProductVariant = PRODUITS.map((p) => [
    ID(`var-${p.cle}`), ID(p.cle), `${p.reference}-1`, p.taille, p.couleur,
  ]);

  // Un seul prix par declinaison, encore en vigueur : endDate reste NULL.
  rows.PriceHistory = PRODUITS.map((p) => [
    ID(`prix-${p.cle}`), ID(`var-${p.cle}`), p.prix, jour(MISE_EN_VENTE, 0), null, 'EUR',
  ]);

  rows.User = CLIENTS.map((c) => [
    ID(c.cle), c.nom, c.email, hashPassword(SEED_PASSWORD, c.email), c.tel,
    jour(INSCRIPTION, 0), jour(INSCRIPTION + 10, 0), c.actif,
  ]);

  // Une adresse de livraison par defaut et par client : l'index unique partiel
  // (uid, type) where isDefault est respecte.
  rows.Address = CLIENTS.map((c) => [
    ID(`adr-${c.cle}`), ID(c.cle), 'shipping', c.rue, c.ville, c.cp, c.pays, true,
  ]);

  rows.Cart = PANIERS.map((p) => [
    ID(`panier-${p.client}`), ID(p.client), jour(p.creation, 0), jour(p.maj, 0),
  ]);

  rows.CartItem = PANIERS.map((p) => [
    ID(`ligne-panier-${p.client}`), ID(`panier-${p.client}`), ID(`var-${p.produit}`), p.quantite,
  ]);

  rows.Promotion = PROMOTIONS.map((p) => [
    ID(p.cle), p.code, p.type, p.valeur, p.portee,
    jour(p.debut, 0), jour(p.fin, 23),
    p.maxUses, p.client ? ID(p.client) : null, p.maxParClient,
  ]);

  rows.PromotionTarget = CIBLES.map((t) => [
    ID(t.promotion), t.produit ? ID(t.produit) : null, t.categorie ? ID(t.categorie) : null,
  ]);

  rows.Order = COMMANDES.map((c) => {
    const client = c.client ? clientParCle[c.client] : null;
    const livraison = c.livraison || { rue: client.rue, ville: client.ville, cp: client.cp, pays: client.pays };
    return [
      ID(c.cle),
      client ? ID(c.client) : null,
      c.numero,
      jour(-c.age, 14),
      c.statut,
      'EUR',
      c.invite ? c.invite.nom : null,
      c.invite ? c.invite.email : null,
      c.invite ? c.invite.tel : null,
      livraison.rue, livraison.ville, livraison.cp, livraison.pays,
      c.promotion ? ID(c.promotion) : null,
    ];
  });

  rows.OrderItem = COMMANDES.map((c) => [
    ID(`ligne-${c.cle}`), ID(c.cle), ID(`var-${c.produit}`),
    c.quantite, produitParCle[c.produit].prix,
  ]);

  return rows;
}

// ---------------------------------------------------------------------------
// Garde-fou
// ---------------------------------------------------------------------------

function verifierExtra() {
  const erreurs = [];
  const bornesStatut = { pending: [0, 7], paid: [0, 45], shipped: [1, 400], delivered: [2, 999], cancelled: [0, 999] };

  for (const c of COMMANDES) {
    // Le produit doit etre en vente a la date de la commande.
    if (-c.age < MISE_EN_VENTE) erreurs.push(`${c.numero} : anterieure a la mise en vente du produit`);

    // Statut compatible avec l'anciennete.
    const [min, max] = bornesStatut[c.statut];
    if (c.age < min || c.age > max) erreurs.push(`${c.numero} : statut ${c.statut} incompatible avec ${c.age} jours`);

    // Client identifie OU invite, jamais les deux ni aucun.
    if (!c.client && !c.invite) erreurs.push(`${c.numero} : ni client ni invite`);
    if (c.client && c.invite) erreurs.push(`${c.numero} : client identifie ET invite`);

    // Commande posterieure a l'inscription du client.
    if (c.client && -c.age < INSCRIPTION) erreurs.push(`${c.numero} : anterieure a l'inscription du client`);

    if (c.quantite <= 0) erreurs.push(`${c.numero} : quantite non positive`);

    if (c.promotion) {
      const promo = promoParCle[c.promotion];
      if (!promo) erreurs.push(`${c.numero} : promotion inconnue`);
      else {
        if (-c.age < promo.debut || -c.age > promo.fin) erreurs.push(`${c.numero} : promotion hors fenetre`);
        if (promo.client && promo.client !== c.client) erreurs.push(`${c.numero} : promotion nominative mal attribuee`);
        if (promo.portee === 'product') {
          const vise = CIBLES.some((t) => t.promotion === c.promotion && t.produit === c.produit);
          if (!vise) erreurs.push(`${c.numero} : la promotion ne vise pas le produit commande`);
        }
      }
    }
  }

  for (const p of PANIERS) {
    if (p.creation < INSCRIPTION) erreurs.push(`Panier de ${p.client} anterieur a l'inscription`);
    if (p.maj < p.creation) erreurs.push(`Panier de ${p.client} : maj avant creation`);
    if (p.quantite <= 0) erreurs.push(`Panier de ${p.client} : quantite non positive`);
  }

  for (const p of PROMOTIONS) {
    if (p.fin <= p.debut) erreurs.push(`${p.code} : fin anterieure au debut`);
    if (p.valeur <= 0) erreurs.push(`${p.code} : valeur non positive`);
    if (p.type === 'percentage' && p.valeur > 100) erreurs.push(`${p.code} : pourcentage superieur a 100`);
  }

  for (const t of CIBLES) {
    if ((t.produit ? 1 : 0) + (t.categorie ? 1 : 0) !== 1) {
      erreurs.push(`${t.promotion} : une cible et une seule est attendue`);
    }
  }

  for (const p of PRODUITS) {
    if (p.prix <= 0) erreurs.push(`${p.reference} : prix non positif`);
  }

  // Unicites internes.
  const doublons = (liste, libelle) => {
    const vus = new Set();
    for (const v of liste) {
      if (vus.has(v)) erreurs.push(`${libelle} : doublon ${v}`);
      vus.add(v);
    }
  };
  doublons(MARQUES.map((m) => m.nom), 'Brand.name');
  doublons(PRODUITS.map((p) => p.reference), 'Product.reference');
  doublons(CLIENTS.map((c) => c.email), 'User.email');
  doublons(COMMANDES.map((c) => c.numero), 'Order.orderNumber');
  doublons(PROMOTIONS.map((p) => p.code), 'Promotion.code');
  doublons(PANIERS.map((p) => p.client), 'Cart.userId');

  return erreurs;
}

/** Identifiants des promotions ajoutees : sert a rendre l'insertion rejouable. */
const ID_PROMOTIONS = PROMOTIONS.map((p) => ID(p.cle));

module.exports = { buildExtraRows, verifierExtra, ID_PROMOTIONS };
