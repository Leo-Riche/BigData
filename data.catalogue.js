'use strict';

/**
 * Lot "catalogue dormant" : des references qui ne se vendent pas.
 *
 * Pourquoi ce lot existe : dans les jeux precedents, les commandes tirent leurs
 * articles uniformement dans tout le catalogue. Avec 6 000 lignes pour 100
 * declinaisons, aucune n'echappe a l'echantillonnage : une requete "jamais
 * achetees" renvoie l'ensemble vide. Et comme chaque declinaison y possede un
 * prix courant, le qualificatif "actives" ne filtre rien non plus.
 *
 * Ce lot cree donc les deux dimensions manquantes, qui sont independantes :
 *
 *                        | jamais achetee | deja achetee
 *   ---------------------|----------------|-------------
 *   active (prix courant)|       10       |  les 100 autres
 *   retiree (prix clos)  |        3       |       2
 *
 * Seules les dix premieres doivent apparaitre dans la reponse. Les trois
 * retirees jamais achetees sont la pour prouver que le filtre "active" sert a
 * quelque chose, et les deux retirees deja achetees pour montrer que les deux
 * criteres ne se recouvrent pas.
 *
 * Dans ce modele, "active" ne peut vouloir dire qu'une chose : disposer d'une
 * ligne de prix ouverte dans PriceHistory (endDate NULL). Il n'existe aucun
 * drapeau isActive sur ProductVariant.
 */

const { INSERT_ORDER, uuid, jour } = require('./data');

const ID = (cle) => uuid(`cat:${cle}`);
const IDPrincipal = (cle) => uuid(cle);

// Periodes de prix : une reference active est en vente depuis 120 jours, une
// reference retiree l'a ete entre -300 et -60 jours.
const DEBUT_ACTIF = -120;
const DEBUT_RETIRE = -300;
const FIN_RETIRE = -60;
const DATE_ACHAT = -200; // tombe dans la periode de la reference retiree

const MARQUES = [
  { cle: 'marque-atelier-nord', nom: 'Atelier Nord' },
  { cle: 'marque-maison-lusitane', nom: 'Maison Lusitane' },
];

// etat : 'actif'        -> prix courant, jamais achetee  (doit sortir)
//        'retire'       -> prix clos, jamais achetee     (ne doit pas sortir)
//        'retire-vendu' -> prix clos, achetee autrefois  (ne doit pas sortir)
const PRODUITS = [
  {
    cle: 'prod-tshirt-studio', marque: 'marque-atelier-nord', categorie: 'category:tshirts',
    nom: 'T-shirt Serigraphie Edition Studio', reference: 'CAT-TS-001',
    description: 'T-shirt serigraphie a la main, edition limitee, coton lourd 220 g.',
    variantes: [
      { suffixe: 'S-BLANC', taille: 'S', couleur: 'Blanc', prix: 34.9, etat: 'actif' },
      { suffixe: 'M-BLANC', taille: 'M', couleur: 'Blanc', prix: 34.9, etat: 'actif' },
      { suffixe: 'L-ECRU', taille: 'L', couleur: 'Ecru', prix: 34.9, etat: 'actif' },
    ],
  },
  {
    cle: 'prod-veste-capsule', marque: 'marque-atelier-nord', categorie: 'category:vestes',
    nom: 'Veste Capsule Atelier Nord', reference: 'CAT-VE-002',
    description: 'Veste non doublee en toile de coton, collection capsule.',
    variantes: [
      { suffixe: 'S', taille: 'S', couleur: null, prix: 159.0, etat: 'actif' },
      { suffixe: 'M', taille: 'M', couleur: null, prix: 159.0, etat: 'actif' },
      { suffixe: 'L', taille: 'L', couleur: null, prix: 159.0, etat: 'actif' },
    ],
  },
  {
    cle: 'prod-sac-atelier', marque: 'marque-maison-lusitane', categorie: 'category:sacs',
    nom: 'Sac Atelier Maison Lusitane', reference: 'CAT-SA-003',
    description: 'Sac en toile enduite, doublure coton, bandouliere amovible.',
    variantes: [
      { suffixe: 'NOIR', taille: null, couleur: 'Noir', prix: 119.0, etat: 'actif' },
      { suffixe: 'SABLE', taille: null, couleur: 'Sable', prix: 119.0, etat: 'actif' },
      { suffixe: 'PRUNE', taille: null, couleur: 'Prune', prix: 119.0, etat: 'retire' },
      { suffixe: 'MOUTARDE', taille: null, couleur: 'Moutarde', prix: 119.0, etat: 'retire' },
    ],
  },
  {
    cle: 'prod-ceinture-vintage', marque: 'marque-maison-lusitane', categorie: 'category:ceintures',
    nom: 'Ceinture Vintage Maison Lusitane', reference: 'CAT-CE-004',
    description: 'Ceinture en cuir tanne vegetal, boucle laiton massif.',
    variantes: [
      { suffixe: '90', taille: '90', couleur: null, prix: 69.0, etat: 'actif' },
      { suffixe: '95', taille: '95', couleur: null, prix: 69.0, etat: 'actif' },
      { suffixe: '100', taille: '100', couleur: null, prix: 69.0, etat: 'retire' },
      { suffixe: '105', taille: '105', couleur: null, prix: 64.0, etat: 'retire-vendu' },
      { suffixe: '110', taille: '110', couleur: null, prix: 64.0, etat: 'retire-vendu' },
    ],
  },
];

// Les deux commandes qui ont ecoule les references "retire-vendu".
// Commandes invite : inutile de creer des comptes pour deux lignes.
const COMMANDES = [
  {
    cle: 'cmd-1', numero: 'ORD-C-000001', variante: 'prod-ceinture-vintage/105', quantite: 1,
    invite: { nom: 'Yann Corbier', email: 'yann.corbier.cat@example.com', tel: '+33612000001' },
    rue: '9 rue de Rivoli', ville: 'Paris', cp: '75001', pays: 'FR',
  },
  {
    cle: 'cmd-2', numero: 'ORD-C-000002', variante: 'prod-ceinture-vintage/110', quantite: 2,
    invite: { nom: 'Helene Ragot', email: 'helene.ragot.cat@example.com', tel: '+33612000002' },
    rue: '27 rue de la Charite', ville: 'Lyon', cp: '69002', pays: 'FR',
  },
];

// ---------------------------------------------------------------------------
// Aplatissement
// ---------------------------------------------------------------------------

const variantes = PRODUITS.flatMap((p) =>
  p.variantes.map((v) => ({
    ...v,
    cle: `${p.cle}/${v.suffixe}`,
    produit: p,
    reference: `${p.reference}-${v.suffixe}`,
  }))
);

const varianteParCle = Object.fromEntries(variantes.map((v) => [v.cle, v]));

// ---------------------------------------------------------------------------
// Assemblage
// ---------------------------------------------------------------------------

function buildCatalogueRows() {
  const rows = Object.fromEntries(INSERT_ORDER.map(([t]) => [t, []]));

  rows.Brand = MARQUES.map((m) => [ID(m.cle), m.nom]);

  rows.Product = PRODUITS.map((p) => [
    ID(p.cle), p.nom, p.description, p.reference, ID(p.marque),
  ]);

  // Les categories existent deja dans le jeu principal.
  rows.ProductCategory = PRODUITS.map((p) => [ID(p.cle), IDPrincipal(p.categorie)]);

  rows.ProductVariant = variantes.map((v) => [
    ID(v.cle), ID(v.produit.cle), v.reference, v.taille, v.couleur,
  ]);

  rows.PriceHistory = variantes.map((v) => {
    const actif = v.etat === 'actif';
    return [
      ID(`prix-${v.cle}`),
      ID(v.cle),
      v.prix,
      jour(actif ? DEBUT_ACTIF : DEBUT_RETIRE, 0),
      actif ? null : jour(FIN_RETIRE, 0),
      'EUR',
    ];
  });

  rows.Order = COMMANDES.map((c) => [
    ID(c.cle), null, c.numero, jour(DATE_ACHAT, 14), 'delivered', 'EUR',
    c.invite.nom, c.invite.email, c.invite.tel,
    c.rue, c.ville, c.cp, c.pays, null,
  ]);

  rows.OrderItem = COMMANDES.map((c) => [
    ID(`ligne-${c.cle}`), ID(c.cle), ID(c.variante),
    c.quantite, varianteParCle[c.variante].prix,
  ]);

  return rows;
}

// ---------------------------------------------------------------------------
// Garde-fou
// ---------------------------------------------------------------------------

function verifierCatalogue() {
  const erreurs = [];

  const references = new Set();
  for (const v of variantes) {
    if (references.has(v.reference)) erreurs.push(`ProductVariant.reference : doublon ${v.reference}`);
    references.add(v.reference);
    if (v.prix <= 0) erreurs.push(`${v.reference} : prix non positif`);
    if (!['actif', 'retire', 'retire-vendu'].includes(v.etat)) erreurs.push(`${v.reference} : etat inconnu`);
  }
  if (FIN_RETIRE <= DEBUT_RETIRE) erreurs.push('Periode retiree : fin anterieure au debut');

  // Les commandes doivent porter sur des references retirees, a une date
  // comprise dans leur periode de prix, sinon le prix facture serait invente.
  for (const c of COMMANDES) {
    const v = varianteParCle[c.variante];
    if (!v) { erreurs.push(`${c.numero} : declinaison inconnue`); continue; }
    if (v.etat !== 'retire-vendu') erreurs.push(`${c.numero} : porte sur une reference qui devrait rester invendue`);
    if (DATE_ACHAT < DEBUT_RETIRE || DATE_ACHAT >= FIN_RETIRE) {
      erreurs.push(`${c.numero} : date hors de la periode de prix de la reference`);
    }
    if (c.quantite <= 0) erreurs.push(`${c.numero} : quantite non positive`);
    if (!c.invite || !c.invite.email) erreurs.push(`${c.numero} : commande invite sans email`);
  }

  // Le lot doit bien contenir les trois categories de references attendues.
  const compte = (etat) => variantes.filter((v) => v.etat === etat).length;
  if (compte('actif') < 5) erreurs.push('moins de 5 references actives invendues : la reponse serait trop maigre');
  if (compte('retire') < 1) erreurs.push('aucune reference retiree invendue : le filtre "active" ne prouverait rien');
  if (compte('retire-vendu') < 1) erreurs.push('aucune reference retiree vendue : les deux criteres sembleraient confondus');

  return erreurs;
}

function resumeCatalogue() {
  return {
    marques: MARQUES.length,
    produits: PRODUITS.length,
    variantes: variantes.length,
    activesInvendues: variantes.filter((v) => v.etat === 'actif').length,
    retireesInvendues: variantes.filter((v) => v.etat === 'retire').length,
    retireesVendues: variantes.filter((v) => v.etat === 'retire-vendu').length,
  };
}

module.exports = { buildCatalogueRows, verifierCatalogue, resumeCatalogue };
