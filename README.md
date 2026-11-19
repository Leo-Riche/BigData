# Base e-commerce : schema Supabase et script de seeding

Schema PostgreSQL conforme au modele drawSQL (`drawSQL-mysql-export-2026-11-18.sql`)
et generateur de donnees coherentes : clients, catalogue, historique de prix,
paniers, promotions et commandes.

## Fichiers

| Fichier | Role |
| --- | --- |
| `schema.supabase.sql` | Schema PostgreSQL : 14 tables, relations, contraintes |
| `seed.supabase.js` | **Point d'entree unique** : applique le schema et insere les cinq lots (`pg`) |
| `data.js` | Lot 1, le generateur principal, independant du SGBD |
| `data.extra.js` | Lot 2, complement ecrit a la main : 5 lignes par table |
| `data.volume.js` | Lot 3, volumetrique : ~1 260 commandes sur 30 villes |
| `data.fideles.js` | Lot 4, 60 clients a l'historique dense sur 12 mois |
| `data.catalogue.js` | Lot 5, 15 declinaisons dormantes, actives ou retirees |
| `schema.sql` / `seed.js` | Equivalents MySQL local, conserves pour memoire |
| `.env.example` | Gabarit des variables de connexion, a copier en `.env` |

---

## Ce que le modele permet, et ce qu'il ne permet pas

Le diagramme comporte 14 tables. Il n'a ni table de paiement, ni table de
livraison, ni table de stock. Consequence directe sur le seeding :

| Domaine demande | Comment il est represente |
| --- | --- |
| Clients | `User` + `Address` |
| Produits | `Brand`, `Category`, `Product`, `ProductCategory`, `ProductVariant` |
| Commandes | `Order` + `OrderItem` |
| **Paiements** | Pas de table dediee. Seul `Order.status` porte l'information : `paid` signifie encaisse. Ni montant encaisse, ni moyen de paiement, ni date de transaction ne sont stockables. |
| **Livraisons** | Pas de table dediee. `Order.status` (`shipped`, `delivered`) et les colonnes `shipping*` de `Order`. Ni transporteur, ni numero de suivi, ni date d'expedition. |
| **Stocks** | **Non representable.** Aucune table ni colonne de quantite disponible n'existe dans le modele. Rien n'est genere pour ce domaine. |

Representer reellement ces trois domaines demanderait d'ajouter des tables
(`Payment`, `Shipment`, `Stock`), ce qui ferait diverger le schema du diagramme.

---

## Mise en place

### 1. Le projet Supabase

Sur [supabase.com](https://supabase.com) : **New project**, une region proche,
et un mot de passe de base de donnees que tu notes.

### 2. Les dependances

```powershell
npm install
```

### 3. La connexion

Dashboard du projet, bouton **Connect**, onglet **Direct / Connection string**,
mode **Session pooler** (port 5432). La connexion directe est en IPv6 seul sur
les plans Free et Pro ; le pooler est joignable en IPv4 partout.

Copie `.env.example` en `.env` et renseigne la ligne :

```
DATABASE_URL=postgresql://postgres.<ref>:<mot-de-passe>@<host>.pooler.supabase.com:5432/postgres
```

Pas de guillemets, pas d'espace autour du `=`. Si le mot de passe contient
`@ : / ? # %`, encode-les (`@` devient `%40`). Les scripts npm chargent `.env`
automatiquement.

`.env` contient le mot de passe de la base : il est dans `.gitignore`, ne le
commite pas et ne le montre pas en capture d'ecran.

### 4. Creer les tables et les remplir

```powershell
npm run setup:supabase
```

Applique `schema.supabase.sql` puis insere les cinq lots, soit environ
**2 430 commandes**. Schema et donnees passent dans **une seule transaction** :
PostgreSQL sait annuler du DDL, donc un echec laisse la base dans son etat
precedent plutot qu'a moitie migree.

Les trois modes du meme script :

| Commande | Effet |
| --- | --- |
| `npm run setup:supabase` | Recree les tables, puis insere tout |
| `npm run seed:supabase` | Vide les tables, puis reinsere tout (schema inchange) |
| `npm run append:supabase` | Insere sans rien vider, en ignorant ce qui est deja la |

`append:supabase` sert a completer une base deja remplie : les lignes
existantes sont detectees par leur identifiant et ignorees
(`ON CONFLICT DO NOTHING`). Le mode affiche le nombre de lignes avant et apres
pour chaque table.

### 5. Les cinq lots de donnees

`seed.supabase.js` assemble cinq lots, dans cet ordre : le jeu principal cree
les categories et les declinaisons auxquelles les quatre autres se rattachent.

0. **`data.js`** : le generateur principal, ~1 080 lignes sur les 14 tables.
   Il est decrit en detail plus bas.
1. **`data.extra.js`** : 5 lignes par table, ecrites a la main.
2. **`data.volume.js`** : environ 1 260 commandes reparties sur 30 villes. Il
   existe parce que les analyses par ville n'ont pas de sens statistique sur
   150 commandes : aucune ville n'y atteint les 30 commandes qu'exigent
   certaines requetes. **Six villes restent volontairement sous ce seuil**,
   sinon un filtre "au moins 30 commandes" ne filtrerait rien.
3. **`data.fideles.js`** : 60 comptes a l'historique dense, de 25 commandes a 6
   sur douze mois. Il existe parce que les deux lots precedents repartissent les
   commandes sur beaucoup de comptes et peu de commandes chacun : le 50e client
   d'un classement s'y retrouve a 4 commandes, a egalite avec 36 autres. Avec ce
   lot, le 1er est a 26 commandes et le 50e a 10. Chaque fidele recoit aussi
   quelques commandes **non encaissees**, pour qu'un filtre sur le statut ait
   quelque chose a ecarter.

4. **`data.catalogue.js`** : 15 declinaisons qui ne se vendent pas. Il existe
   parce que les commandes tirent leurs articles uniformement dans tout le
   catalogue : avec 6 000 lignes pour 100 declinaisons, aucune n'echappe a
   l'echantillonnage, et une requete "jamais achetees" renvoie l'ensemble vide.
   Le lot cree deux dimensions independantes, **active** (ligne de prix ouverte)
   et **deja achetee** :

   | | jamais achetee | deja achetee |
   | --- | --- | --- |
   | **active** | 10 | les 100 autres |
   | **retiree** | 3 | 2 |

   Les trois retirees invendues prouvent que le filtre "active" sert a quelque
   chose ; les deux retirees vendues, que les deux criteres ne se recouvrent pas.

Les lots generes ne touchent ni aux promotions ni aux paniers : ils reprennent
les declinaisons existantes a leur prix courant, et ne retiennent que celles
dont ce prix etait deja publie a la date de la commande. Les fideles sont
rattaches aux seules villes deja au-dessus de 30 commandes, pour ne pas faire
basculer les six petites villes au-dessus du seuil.

Base complete apres les quatre lots : environ **2 430 commandes**, 328 comptes
clients, 115 declinaisons, 24 villes a 30 commandes ou plus et 7 en dessous.

Dans ce modele, **"active" ne peut vouloir dire qu'une chose** : disposer d'une
ligne de prix ouverte dans `PriceHistory` (`endDate` NULL). Il n'existe aucun
drapeau `isActive` sur `ProductVariant`.

Ce complement vit dans `data.extra.js`, separe du generateur principal. Il est
ecrit a la main : 5 lignes par table se lisent et se verifient directement,
la ou un tirage aleatoire n'apporterait rien a cette echelle.

Deux regles de construction le rendent sans danger pour les donnees en place :

- toutes ses cles metier sont prefixees `ext:`, donc les UUID produits ne
  peuvent pas entrer en collision avec ceux du jeu principal ;
- ses lignes ne referencent que ses propres lignes, sauf les categories
  parentes, qui existent deja. Rien ne depend de l'etat exact de la base, et
  aucune ligne existante n'est modifiee.

La commande est **rejouable** : `ON CONFLICT DO NOTHING` ignore les lignes deja
presentes. `PromotionTarget` n'ayant ni cle primaire ni unicite, ses lignes de
complement sont supprimees puis reinserees, ce qui evite les doublons.

Le complement couvre les memes cas que le jeu principal : un client inactif,
cinq statuts de commande differents, deux commandes invite, une promotion
nominative, une promotion a portee produit effectivement appliquee a une
commande qui contient ce produit, des declinaisons avec taille seule, couleur
seule, ou les deux.

---

## Le generateur

`data.js` produit environ **1 080 lignes** sur les 14 tables :

| Table | Volume |
| --- | --- |
| `Brand` / `Category` | 6 / 10 |
| `Product` / `ProductVariant` | 30 / ~95 |
| `PriceHistory` | ~220 lignes, dont ~110 periodes closes |
| `User` / `Address` | 40 / ~57 |
| `Cart` / `CartItem` | ~16 / ~25 |
| `Promotion` / `PromotionTarget` | 12 / 6 |
| `Order` / `OrderItem` | 150 / ~375 |

Les volumes se reglent dans l'objet `PARAMS` en haut de `data.js`.

### Reproductible

Le tirage aleatoire part d'une **graine fixe** (`PARAMS.graine`) et les
identifiants sont des UUID derives d'une cle metier. Deux executions produisent
exactement les memes lignes, avec les memes identifiants. Changer la graine
change tout le jeu de donnees d'un coup.

### Aucune donnee impossible

C'est la contrainte principale du generateur. Les regles tenues :

**Historique de prix.** Chaque declinaison a une suite de periodes **contigues
et sans chevauchement** par devise : `[lancement, c1)`, `[c1, c2)`, `[c2, ∞)`.
Une seule periode reste ouverte (`endDate` NULL), c'est le prix courant.

**Prix des commandes.** Le `unitPrice` d'une ligne n'est jamais invente : c'est
le prix qui etait **publie a la date de la commande**, dans la devise de la
commande, lu dans `PriceHistory`. Un article sans prix publie a cette date ne
peut pas etre commande ce jour-la.

**Chronologie.** Un client ne commande pas avant son inscription. Un panier
n'est pas anterieur a l'inscription de son proprietaire. `updatedAt` n'est
jamais anterieur a `createdAt`.

**Cycle de vie.** Le statut est compatible avec l'anciennete : une commande
passee hier n'est pas deja `delivered`, une commande d'il y a six mois ne reste
pas `pending`. Un tiers des commandes tombe sur le mois ecoule, pour que les
cinq statuts soient tous representes.

**Promotions.** Une commande ne reference une promotion que si la date de
commande tombe dans sa fenetre de validite, si les quotas `maxUses` et
`maxUsesPerUser` ne sont pas depasses, si la portee correspond au contenu reel
du panier (`product` : la commande contient un produit cible ; `category` : un
produit de la categorie ciblee), et si une promotion nominative est bien
utilisee par son titulaire — donc jamais par un invite.

**Identite.** Une commande a soit un `userId`, soit un invite nomme avec son
email, jamais les deux, jamais aucun.

**Declinaisons.** La combinatoire depend du type de produit : un sac n'a pas de
taille S/M/L, une ceinture n'a pas de couleur. Les quatre cas du modele sont
representes : taille et couleur, taille seule, couleur seule, aucun des deux.

### Le garde-fou

Avant toute ecriture, `verifierCoherence()` repasse sur le jeu genere et
verifie une trentaine d'invariantes : unicites, periodes de prix, chronologie,
coherence des statuts, quotas de promotions, prix unitaires relus depuis
l'historique. **Si une seule invariante est violee, le script s'arrete sans
rien inserer** et affiche ce qui cloche.

---

## Les contraintes du schema

Au-dela des cles primaires, etrangeres et des unicites du diagramme,
`schema.supabase.sql` pose 31 regles declaratives. La base refuse elle-meme les
donnees impossibles, independamment du script.

| Table | Regles |
| --- | --- |
| `User` | email bien forme et unique, nom non vide, `updatedAt >= createdAt` |
| `Address` | `type` limite a `billing`/`shipping`, pays en ISO 3166-1 alpha-2, au plus une adresse par defaut par type et par client (index unique partiel) |
| `Category` | une categorie ne peut pas etre sa propre parente |
| `PriceHistory` | prix positif, `endDate > startDate`, devise en ISO 4217 |
| `CartItem` / `OrderItem` | quantite strictement positive, prix unitaire positif, une declinaison au plus une fois par panier et par commande |
| `Promotion` | type `percentage`/`fixed`, portee `cart`/`product`/`category`, valeur positive, pourcentage plafonne a 100, `endDate > startDate`, quotas positifs |
| `PromotionTarget` | exactement une cible : un produit **ou** une categorie |
| `Order` | statut parmi les cinq valeurs, devise et pays normalises, un client identifie **ou** un invite nomme avec son email |

Deux regles ne sont pas posees car elles demandent un trigger plutot qu'une
contrainte declarative : les cycles longs de categories (A parent de B, B parent
de A) et la coherence entre `Promotion.scope` et les lignes de `PromotionTarget`.

### Corrections apportees au diagramme

L'export drawSQL contient cinq cles etrangeres incoherentes qui rendent toute
insertion impossible. Le schema livre les corrige :

| Contrainte | Export drawSQL | Corrige en |
| --- | --- | --- |
| `cartitem_cartid_foreign` | `CartItem.cartId` -> `ProductVariant(productId)` | `Cart(id)` |
| `cartitem_id_foreign` | `CartItem.id` -> `Cart(id)` | supprimee (doublon parasite) |
| `orderitem_id_foreign` | `OrderItem.id` -> `Order(id)` | `OrderItem.orderId` -> `Order(id)` |
| `pricehistory_productvariantid_foreign` | `PriceHistory.productVariantId` -> `ProductVariant(productId)` | `ProductVariant(id)` |
| `order_promotionid_foreign` | `Order.promotionId` -> `PromotionTarget(promotionId)` | `Promotion(id)` |

Portage PostgreSQL : `CHAR(36)` devient `uuid`, `DATETIME` devient `timestamptz`,
`DECIMAL` devient `numeric`, les identifiants sont entre guillemets doubles
(PostgreSQL met en minuscules ce qui n'est pas quote, or le modele est en
camelCase), et les index de cles etrangeres sont crees explicitement.

---

## Verifier le resultat

Dashboard > **Table Editor**, ou dans le SQL Editor :

```sql
-- Chiffre d'affaires par statut
select o.status, count(distinct o.id) as commandes,
       round(sum(oi.quantity * oi."unitPrice"), 2) as total
from "Order" o join "OrderItem" oi on oi."orderId" = o.id
group by o.status order by total desc;
```

```sql
-- Prix unitaire facture contre prix publie a la date de la commande
select o."orderNumber", pv.reference, oi."unitPrice", ph.price as prix_publie
from "Order" o
join "OrderItem" oi on oi."orderId" = o.id
join "ProductVariant" pv on pv.id = oi."productVariantId"
join "PriceHistory" ph on ph."productVariantId" = pv.id
  and ph.currency = o.currency
  and o."orderDate" >= ph."startDate"
  and (ph."endDate" is null or o."orderDate" < ph."endDate")
where oi."unitPrice" <> ph.price;
-- 0 ligne : aucun prix facture ne diverge de l'historique
```

---

## Securite : RLS et cles API

`schema.supabase.sql` active **Row Level Security** sur les 14 tables. Dans
Supabase, toute table du schema `public` est exposee par l'API REST et serait
lisible avec la cle `anon`, qui est publique. RLS activee sans policy : l'API
refuse tout. Le seed n'est pas concerne, il passe par une connexion Postgres
directe en role `postgres`, qui contourne RLS.

Pour brancher une application, ajoute une policy par cas d'usage :

```sql
create policy "catalogue public" on "Product"
  for select to anon, authenticated using (true);

create policy "mes commandes" on "Order"
  for select to authenticated using ("userId" = auth.uid());
```

Les cles API sont dans *Settings > API* : `anon` pour le front, `service_role`
cote serveur uniquement, jamais dans du code client.

## Depannage

| Symptome | Cause probable |
| --- | --- |
| `DATABASE_URL non definie` | La valeur est dans `.env.example` (gabarit, jamais lu) au lieu de `.env` |
| `ENETUNREACH` | Connexion directe en IPv6 depuis un reseau IPv4 : passer au Session pooler |
| `ENOTFOUND` | Hote mal recopie : reprendre la chaine depuis le bouton Connect |
| `28P01` | Mot de passe faux, ou caracteres speciaux non encodes |
| Erreur d'authentification sur le pooler | Le pooler attend `postgres.<ref>` comme utilisateur, pas `postgres` |
| `self signed certificate` | Telecharger le certificat (*Settings > Database > SSL*) et pointer `SUPABASE_CA_CERT` dessus |

## Donnees de test

Les comptes generes utilisent le domaine `example.com` et partagent le meme mot
de passe, defini par `SEED_PASSWORD` dans `data.js`. Les mots de passe sont
stockes en hash scrypt, jamais en clair.
