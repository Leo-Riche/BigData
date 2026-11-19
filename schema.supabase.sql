-- Schema e-commerce, version PostgreSQL / Supabase.
-- Portage de schema.sql (MySQL) avec les memes corrections de cles etrangeres
-- par rapport a l'export drawSQL du 2026-11-18.
--
-- A executer dans Supabase : Dashboard > SQL Editor > New query > coller > Run,
-- ou via "npm run setup:supabase".
--
-- Differences avec la version MySQL :
--   * CHAR(36)  -> uuid
--   * DATETIME  -> timestamptz
--   * DECIMAL   -> numeric
--   * identifiants entre guillemets doubles : PostgreSQL met en minuscules
--     tout identifiant non quote, or le modele est en camelCase.
--   * les index de cles etrangeres sont crees explicitement (PostgreSQL ne les
--     cree pas automatiquement, contrairement a MySQL).
--   * contraintes CHECK metier (cette version uniquement, cf. README).
--   * Row Level Security activee sur toutes les tables (voir la fin du fichier).
--
-- Chaque contrainte porte un nom explicite : c'est ce nom que PostgreSQL
-- renvoie dans le message d'erreur, et que test.supabase.js verifie.

-- ---------------------------------------------------------------------------
-- Remise a zero
-- ---------------------------------------------------------------------------

DROP TABLE IF EXISTS "OrderItem" CASCADE;
DROP TABLE IF EXISTS "Order" CASCADE;
DROP TABLE IF EXISTS "PromotionTarget" CASCADE;
DROP TABLE IF EXISTS "Promotion" CASCADE;
DROP TABLE IF EXISTS "CartItem" CASCADE;
DROP TABLE IF EXISTS "Cart" CASCADE;
DROP TABLE IF EXISTS "PriceHistory" CASCADE;
DROP TABLE IF EXISTS "ProductVariant" CASCADE;
DROP TABLE IF EXISTS "ProductCategory" CASCADE;
DROP TABLE IF EXISTS "Product" CASCADE;
DROP TABLE IF EXISTS "Category" CASCADE;
DROP TABLE IF EXISTS "Brand" CASCADE;
DROP TABLE IF EXISTS "Address" CASCADE;
DROP TABLE IF EXISTS "User" CASCADE;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

CREATE TABLE "User" (
    "id"          uuid PRIMARY KEY,
    "name"        varchar(255) NOT NULL,
    "email"       varchar(255) NOT NULL,
    "password"    varchar(255) NOT NULL,
    "phoneNumber" varchar(255) NOT NULL,
    "createdAt"   timestamptz  NOT NULL,
    "updatedAt"   timestamptz  NOT NULL,
    "isActive"    boolean      NOT NULL,
    CONSTRAINT user_email_unique UNIQUE ("email"),
    -- Forme minimale d'un email : pas d'espace, un @, un point apres le @.
    CONSTRAINT user_email_format CHECK ("email" ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
    CONSTRAINT user_name_not_blank CHECK (btrim("name") <> ''),
    CONSTRAINT user_dates_coherent CHECK ("updatedAt" >= "createdAt")
);

CREATE TABLE "Address" (
    "id"         uuid PRIMARY KEY,
    "uid"        uuid         NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
    "type"       varchar(255) NOT NULL,
    "street"     varchar(255) NOT NULL,
    "city"       varchar(255) NOT NULL,
    "postalCode" varchar(255) NOT NULL,
    "country"    varchar(255) NOT NULL,
    "isDefault"  boolean      NOT NULL,
    CONSTRAINT address_type_valid CHECK ("type" IN ('billing', 'shipping')),
    -- Code pays ISO 3166-1 alpha-2.
    CONSTRAINT address_country_iso CHECK ("country" ~ '^[A-Z]{2}$')
);
CREATE INDEX address_uid_index ON "Address" ("uid");
-- Au plus une adresse par defaut par utilisateur ET par type.
-- Index unique partiel : PostgreSQL le sait faire, MySQL non.
CREATE UNIQUE INDEX address_one_default_per_type
    ON "Address" ("uid", "type") WHERE "isDefault";

CREATE TABLE "Brand" (
    "id"   uuid PRIMARY KEY,
    "name" varchar(255) NOT NULL,
    CONSTRAINT brand_name_unique UNIQUE ("name"),
    CONSTRAINT brand_name_not_blank CHECK (btrim("name") <> '')
);

CREATE TABLE "Category" (
    "id"       uuid PRIMARY KEY,
    "name"     varchar(255) NOT NULL,
    "parentId" uuid NULL REFERENCES "Category"("id") ON DELETE SET NULL,
    -- Empeche le cycle le plus court. Les cycles plus longs (A -> B -> A)
    -- demandent un trigger recursif, hors perimetre ici.
    CONSTRAINT category_not_self_parent CHECK ("parentId" IS NULL OR "parentId" <> "id")
);
CREATE INDEX category_parentid_index ON "Category" ("parentId");

CREATE TABLE "Product" (
    "id"          uuid PRIMARY KEY,
    "name"        varchar(255) NOT NULL,
    "description" text         NOT NULL,
    "reference"   varchar(255) NOT NULL,
    "brandId"     uuid         NOT NULL REFERENCES "Brand"("id"),
    CONSTRAINT product_reference_unique UNIQUE ("reference"),
    CONSTRAINT product_reference_not_blank CHECK (btrim("reference") <> '')
);
CREATE INDEX product_brandid_index ON "Product" ("brandId");

CREATE TABLE "ProductCategory" (
    "productId"  uuid NOT NULL REFERENCES "Product"("id") ON DELETE CASCADE,
    "categoryId" uuid NOT NULL REFERENCES "Category"("id") ON DELETE CASCADE,
    CONSTRAINT productcategory_productid_categoryid_unique UNIQUE ("productId", "categoryId")
);
CREATE INDEX productcategory_categoryid_index ON "ProductCategory" ("categoryId");

CREATE TABLE "ProductVariant" (
    "id"        uuid PRIMARY KEY,
    "productId" uuid         NOT NULL REFERENCES "Product"("id") ON DELETE CASCADE,
    "reference" varchar(255) NOT NULL,
    "size"      varchar(255) NULL,
    "color"     varchar(255) NULL,
    CONSTRAINT productvariant_reference_unique UNIQUE ("reference"),
    CONSTRAINT productvariant_reference_not_blank CHECK (btrim("reference") <> '')
);
CREATE INDEX productvariant_productid_index ON "ProductVariant" ("productId");

CREATE TABLE "PriceHistory" (
    "id"               uuid PRIMARY KEY,
    "productVariantId" uuid         NOT NULL REFERENCES "ProductVariant"("id") ON DELETE CASCADE,
    "price"            numeric(8,2) NOT NULL,
    "startDate"        timestamptz  NOT NULL,
    "endDate"          timestamptz  NULL,
    "currency"         varchar(255) NOT NULL,
    CONSTRAINT pricehistory_price_positive CHECK ("price" >= 0),
    CONSTRAINT pricehistory_period_valid CHECK ("endDate" IS NULL OR "endDate" > "startDate"),
    CONSTRAINT pricehistory_currency_iso CHECK ("currency" ~ '^[A-Z]{3}$')
);
CREATE INDEX pricehistory_variant_index ON "PriceHistory" ("productVariantId", "startDate");

CREATE TABLE "Cart" (
    "id"        uuid PRIMARY KEY,
    "userId"    uuid        NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
    "createdAt" timestamptz NOT NULL,
    "updatedAt" timestamptz NOT NULL,
    CONSTRAINT cart_userid_unique UNIQUE ("userId"),
    CONSTRAINT cart_dates_coherent CHECK ("updatedAt" >= "createdAt")
);

CREATE TABLE "CartItem" (
    "id"               uuid PRIMARY KEY,
    "cartId"           uuid NOT NULL REFERENCES "Cart"("id") ON DELETE CASCADE,
    "productVariantId" uuid NOT NULL REFERENCES "ProductVariant"("id"),
    "quantity"         integer NOT NULL,
    CONSTRAINT cartitem_cartid_productvariantid_unique UNIQUE ("cartId", "productVariantId"),
    CONSTRAINT cartitem_quantity_positive CHECK ("quantity" > 0)
);
CREATE INDEX cartitem_productvariantid_index ON "CartItem" ("productVariantId");

CREATE TABLE "Promotion" (
    "id"             uuid PRIMARY KEY,
    "code"           varchar(255) NOT NULL,
    "discountType"   varchar(255) NOT NULL,
    "discountValue"  numeric(8,2) NOT NULL,
    "scope"          varchar(255) NOT NULL,
    "startDate"      timestamptz  NOT NULL,
    "endDate"        timestamptz  NOT NULL,
    "maxUses"        integer NULL,
    "userId"         uuid NULL REFERENCES "User"("id") ON DELETE CASCADE,
    "maxUsesPerUser" integer NULL,
    CONSTRAINT promotion_code_unique UNIQUE ("code"),
    CONSTRAINT promotion_type_valid CHECK ("discountType" IN ('percentage', 'fixed')),
    CONSTRAINT promotion_scope_valid CHECK ("scope" IN ('cart', 'product', 'category')),
    CONSTRAINT promotion_value_positive CHECK ("discountValue" > 0),
    -- Une remise en pourcentage ne peut pas depasser 100 %.
    CONSTRAINT promotion_percentage_max CHECK ("discountType" <> 'percentage' OR "discountValue" <= 100),
    CONSTRAINT promotion_period_valid CHECK ("endDate" > "startDate"),
    CONSTRAINT promotion_maxuses_positive CHECK ("maxUses" IS NULL OR "maxUses" > 0),
    CONSTRAINT promotion_maxusesperuser_positive CHECK ("maxUsesPerUser" IS NULL OR "maxUsesPerUser" > 0)
);
CREATE INDEX promotion_userid_index ON "Promotion" ("userId");

CREATE TABLE "PromotionTarget" (
    "promotionId" uuid NOT NULL REFERENCES "Promotion"("id") ON DELETE CASCADE,
    "productId"   uuid NULL REFERENCES "Product"("id") ON DELETE CASCADE,
    "categoryId"  uuid NULL REFERENCES "Category"("id") ON DELETE CASCADE,
    -- Une cible et une seule : soit un produit, soit une categorie.
    CONSTRAINT promotiontarget_exactly_one CHECK (num_nonnulls("productId", "categoryId") = 1)
);
CREATE INDEX promotiontarget_promotionid_index ON "PromotionTarget" ("promotionId");
CREATE INDEX promotiontarget_productid_index ON "PromotionTarget" ("productId");
CREATE INDEX promotiontarget_categoryid_index ON "PromotionTarget" ("categoryId");

CREATE TABLE "Order" (
    "id"                 uuid PRIMARY KEY,
    "userId"             uuid NULL REFERENCES "User"("id") ON DELETE SET NULL,
    "orderNumber"        varchar(255) NOT NULL,
    "orderDate"          timestamptz  NOT NULL,
    "status"             varchar(255) NOT NULL,
    "currency"           varchar(255) NOT NULL,
    "guestName"          varchar(255) NULL,
    "guestEmail"         varchar(255) NULL,
    "guestPhoneNumber"   varchar(255) NULL,
    "shippingStreet"     varchar(255) NOT NULL,
    "shippingCity"       varchar(255) NOT NULL,
    "shippingPostalCode" varchar(255) NOT NULL,
    "shippingCountry"    varchar(255) NOT NULL,
    "promotionId"        uuid NULL REFERENCES "Promotion"("id") ON DELETE SET NULL,
    CONSTRAINT order_ordernumber_unique UNIQUE ("orderNumber"),
    CONSTRAINT order_status_valid CHECK ("status" IN ('pending', 'paid', 'shipped', 'delivered', 'cancelled')),
    CONSTRAINT order_currency_iso CHECK ("currency" ~ '^[A-Z]{3}$'),
    CONSTRAINT order_shipping_country_iso CHECK ("shippingCountry" ~ '^[A-Z]{2}$'),
    -- Une commande appartient soit a un compte, soit a un invite identifie.
    CONSTRAINT order_client_or_guest CHECK (
        "userId" IS NOT NULL
        OR ("guestName" IS NOT NULL AND "guestEmail" IS NOT NULL)
    ),
    CONSTRAINT order_guest_email_format CHECK (
        "guestEmail" IS NULL
        OR "guestEmail" ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
    )
);
CREATE INDEX order_userid_index ON "Order" ("userId");
CREATE INDEX order_promotionid_index ON "Order" ("promotionId");

CREATE TABLE "OrderItem" (
    "id"               uuid PRIMARY KEY,
    "orderId"          uuid NOT NULL REFERENCES "Order"("id") ON DELETE CASCADE,
    -- Pas de ON DELETE : on ne peut pas supprimer une declinaison deja commandee,
    -- l'historique de facturation doit rester lisible.
    "productVariantId" uuid NOT NULL REFERENCES "ProductVariant"("id"),
    "quantity"         integer      NOT NULL,
    "unitPrice"        numeric(8,2) NOT NULL,
    CONSTRAINT orderitem_order_variant_unique UNIQUE ("orderId", "productVariantId"),
    CONSTRAINT orderitem_quantity_positive CHECK ("quantity" > 0),
    CONSTRAINT orderitem_unitprice_positive CHECK ("unitPrice" >= 0)
);
CREATE INDEX orderitem_orderid_index ON "OrderItem" ("orderId");
CREATE INDEX orderitem_productvariantid_index ON "OrderItem" ("productVariantId");

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
-- Dans Supabase, toute table du schema "public" est exposee par l'API REST et
-- lisible avec la cle "anon" si RLS n'est pas activee. On l'active partout :
-- sans policy, l'API refuse tout. Les connexions Postgres directes (ce projet)
-- et la cle service_role ne sont pas concernees par RLS.
--
-- Ajouter ensuite une policy par cas d'usage, par exemple pour le catalogue :
--   CREATE POLICY "catalogue public en lecture" ON "Product"
--     FOR SELECT TO anon, authenticated USING (true);

ALTER TABLE "User"            ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Address"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Brand"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Category"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Product"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProductCategory" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProductVariant"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PriceHistory"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Cart"            ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CartItem"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Promotion"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PromotionTarget" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Order"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OrderItem"       ENABLE ROW LEVEL SECURITY;
