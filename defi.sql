-- Défi 1
-- Quel est le montant moyen d'une commande validée dans chaque pays de livraison ? Comparez le nombre de commandes et le chiffre d'affaires.

with commandes_validees as (
    select o.id,
           o."shippingCountry" as pays,
           sum(oi.quantity * oi."unitPrice") as montant
    from "Order" o
    join "OrderItem" oi on oi."orderId" = o.id
    where o.status in ('paid', 'shipped', 'delivered')
    group by o.id, o."shippingCountry"
)
select pays,
       count(*)                  as nb_commandes,
       round(sum(montant), 2)    as chiffre_affaires,
       round(avg(montant), 2)    as montant_moyen
from commandes_validees
group by pays
order by chiffre_affaires desc;

-- Défi 2
-- Quelles sont les 20 villes au panier moyen le plus élevé, parmi celles ayant au moins 30 commandes ?

with totaux as (
    select o.id,
           o."shippingCity" as ville,
           sum(oi.quantity * oi."unitPrice") as montant
    from "Order" o
    join "OrderItem" oi on oi."orderId" = o.id
    group by o.id, o."shippingCity"
)
select ville,
       count(*)               as nb_commandes,
       round(avg(montant), 2) as panier_moyen,
       round(sum(montant), 2) as chiffre_affaires
from totaux
group by ville
having count(*) >= 30
order by panier_moyen desc
limit 20;

-- Défi 3
--Quels sont les 50 clients avec le plus de commandes payées sur 12 mois ? affichez aussi leur dépense totale

with commandes_payees as (
    select o.id,
           o."userId",
           sum(oi.quantity * oi."unitPrice") as montant
    from "Order" o
    join "OrderItem" oi on oi."orderId" = o.id
    where o."userId" is not null
      and o.status in ('paid', 'shipped', 'delivered')
      and o."orderDate" >= now() - interval '12 months'
    group by o.id, o."userId"
)
select u.name  as client,
       u.email,
       count(*)               as nb_commandes,
       round(sum(montant), 2) as depense_totale
from commandes_payees c
join "User" u on u.id = c."userId"
group by u.id, u.name, u.email
order by nb_commandes desc, depense_totale desc
limit 50;

-- Défi 4
-- Quelles variantes actives du catalogue n'ont jamais été achetées ?

select p.reference   as produit,
       p.name        as nom_produit,
       pv.reference  as declinaison,
       pv.size,
       pv.color,
       ph.price,
       ph.currency,
       ph."startDate" as en_vente_depuis
from "ProductVariant" pv
join "Product" p on p.id = pv."productId"
join "PriceHistory" ph on ph."productVariantId" = pv.id
                      and ph."endDate" is null
where not exists (
    select 1 from "OrderItem" oi
    where oi."productVariantId" = pv.id
)
order by ph."startDate", pv.reference;

-- Défi 5
-- Classez les marques par chiffre d'affaires en tenant compte des quantités et des prix réellement payées.

select b.name                                   as marque,
       count(distinct o.id)                     as nb_commandes,
       sum(oi.quantity)                         as unites_vendues,
       round(sum(oi.quantity * oi."unitPrice"), 2) as chiffre_affaires,
       round(avg(oi."unitPrice"), 2)            as prix_moyen_paye
from "OrderItem" oi
join "Order" o           on o.id  = oi."orderId"
join "ProductVariant" pv on pv.id = oi."productVariantId"
join "Product" p         on p.id  = pv."productId"
join "Brand" b           on b.id  = p."brandId"
where o.status in ('paid', 'shipped', 'delivered')
group by b.id, b.name
order by chiffre_affaires desc;

-- Défi 7
-- Quels clients ayant déjà acheté n'ont rien commandé depuis 180 jours

with commandes as (
    select o.id,
           o."userId",
           o."orderDate",
           sum(oi.quantity * oi."unitPrice") as montant
    from "Order" o
    join "OrderItem" oi on oi."orderId" = o.id
    where o."userId" is not null
      and o.status in ('paid', 'shipped', 'delivered')
    group by o.id, o."userId", o."orderDate"
)
select u.name  as client,
       u.email,
       count(*)                                   as nb_commandes,
       round(sum(c.montant), 2)                   as depense_totale,
       max(c."orderDate")::date                   as derniere_commande,
       current_date - max(c."orderDate")::date     as jours_de_silence
from commandes c
join "User" u on u.id = c."userId"
group by u.id, u.name, u.email
having max(c."orderDate") < now() - interval '180 days'
order by max(c."orderDate");

-- Défi 8
-- Quelle catégorie réalise le plus de vente dans chaque pays ? Un produit peut appartenir à plusieurs catégories

with recursive rattachements as (
    select pc."productId", pc."categoryId"
    from "ProductCategory" pc
  union
    select r."productId", c."parentId"
    from rattachements r
    join "Category" c on c.id = r."categoryId"
    where c."parentId" is not null
),
ventes as (
    select o."shippingCountry" as pays,
           r."categoryId",
           count(distinct o.id)                     as nb_commandes,
           sum(oi.quantity)                         as unites,
           sum(oi.quantity * oi."unitPrice")        as chiffre_affaires
    from "OrderItem" oi
    join "Order" o           on o.id  = oi."orderId"
    join "ProductVariant" pv on pv.id = oi."productVariantId"
    join rattachements r     on r."productId" = pv."productId"
    where o.status in ('paid', 'shipped', 'delivered')
    group by o."shippingCountry", r."categoryId"
)
select distinct on (v.pays)
       v.pays,
       c.name as categorie,
       case when c."parentId" is null then 'racine' else 'sous-categorie' end as niveau,
       v.nb_commandes,
       v.unites,
       round(v.chiffre_affaires, 2) as chiffre_affaires
from ventes v
join "Category" c on c.id = v."categoryId"
order by v.pays, v.chiffre_affaires desc;

-- Défi 18
-- Quelle est la variation en euros et en pourcentage du chiffre d'affaire par pays par rapport au mois précédent, y compris les mois à zéro ?

with ventes as (
    select o."shippingCountry"                as pays,
           date_trunc('month', o."orderDate") as mois,
           sum(oi.quantity * oi."unitPrice")  as ca
    from "Order" o
    join "OrderItem" oi on oi."orderId" = o.id
    where o.status in ('paid', 'shipped', 'delivered')
      and o.currency = 'EUR'
      and o."orderDate" >= date_trunc('month', now()) - interval '1 month'
    group by 1, 2
),
pays as (
    select distinct "shippingCountry" as pays from "Order"
),
socle as (
    select p.pays,
           coalesce(prec.ca, 0) as ca_precedent,
           coalesce(cour.ca, 0) as ca_courant
    from pays p
    left join ventes prec on prec.pays = p.pays
                         and prec.mois = date_trunc('month', now()) - interval '1 month'
    left join ventes cour on cour.pays = p.pays
                         and cour.mois = date_trunc('month', now())
)
select pays,
       to_char(date_trunc('month', now()) - interval '1 month', 'YYYY-MM') as mois_precedent,
       round(ca_precedent, 2)                                              as ca_precedent,
       to_char(date_trunc('month', now()), 'YYYY-MM')                      as mois_courant,
       round(ca_courant, 2)                                                as ca_courant,
       round(ca_courant - ca_precedent, 2)                                 as variation_euros,
       round(100 * (ca_courant - ca_precedent)
             / nullif(ca_precedent, 0), 1)                                 as variation_pct
from socle
order by variation_euros desc;

-- Défi 19
-- Quelle proportion des clients repasse commande dans les 30, 60 et 90 jours après leur premier achat ?

with achats as (
    select o."userId",
           o."orderDate",
           row_number() over (partition by o."userId" order by o."orderDate") as rang
    from "Order" o
    where o."userId" is not null
      and o.status in ('paid', 'shipped', 'delivered')
),
parcours as (
    select "userId",
           min("orderDate") filter (where rang = 1) as premiere,
           min("orderDate") filter (where rang = 2) as deuxieme
    from achats
    group by "userId"
),
delais as (
    select "userId",
           extract(epoch from (now() - premiere))      / 86400 as anciennete_jours,
           extract(epoch from (deuxieme - premiere))   / 86400 as delai_jours
    from parcours
)
select h.horizon::text || ' jours' as fenetre,
       count(*) filter (where anciennete_jours >= h.horizon)
           as clients_observables,
       count(*) filter (where anciennete_jours >= h.horizon
                          and delai_jours <= h.horizon)
           as ont_rachete,
       round(100.0 * count(*) filter (where anciennete_jours >= h.horizon
                                        and delai_jours <= h.horizon)
                   / nullif(count(*) filter (where anciennete_jours >= h.horizon), 0), 1)
           as taux_pct
from delais
cross join (values (30), (60), (90)) as h(horizon)
group by h.horizon
order by h.horizon;

-- Défi 20
-- Quelles paires de variantes sont les plus fréquentes dans une même commande ? Compter chaque paie une fois par commande.

select va.reference as declinaison_a,
       pa.name      as produit_a,
       vb.reference as declinaison_b,
       pb.name      as produit_b,
       count(distinct a."orderId") as nb_commandes
from "OrderItem" a
join "OrderItem" b
       on b."orderId"          = a."orderId"
      and b."productVariantId" > a."productVariantId"
join "ProductVariant" va on va.id = a."productVariantId"
join "Product"        pa on pa.id = va."productId"
join "ProductVariant" vb on vb.id = b."productVariantId"
join "Product"        pb on pb.id = vb."productId"
group by va.reference, pa.name, vb.reference, pb.name
order by nb_commandes desc, declinaison_a, declinaison_b
limit 20;