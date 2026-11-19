-- Schema e-commerce, base sur l'export drawSQL du 2026-11-18.
--
-- Corrections apportees par rapport a l'export brut (les FK suivantes etaient
-- incoherentes et rendaient toute insertion impossible) :
--   * CartItem.cartId               -> Cart(id)             (pointait sur ProductVariant.productId)
--   * CartItem : suppression de la FK parasite CartItem.id  -> Cart(id)
--   * OrderItem.orderId             -> Order(id)            (la FK etait posee sur OrderItem.id)
--   * PriceHistory.productVariantId -> ProductVariant(id)   (pointait sur ProductVariant.productId)
--   * Order.promotionId             -> Promotion(id)        (pointait sur PromotionTarget.promotionId)
-- Ajout des regles ON DELETE et des index utiles aux requetes de lecture.

SET FOREIGN_KEY_CHECKS = 0;

DROP TABLE IF EXISTS `OrderItem`;
DROP TABLE IF EXISTS `Order`;
DROP TABLE IF EXISTS `PromotionTarget`;
DROP TABLE IF EXISTS `Promotion`;
DROP TABLE IF EXISTS `CartItem`;
DROP TABLE IF EXISTS `Cart`;
DROP TABLE IF EXISTS `PriceHistory`;
DROP TABLE IF EXISTS `ProductVariant`;
DROP TABLE IF EXISTS `ProductCategory`;
DROP TABLE IF EXISTS `Product`;
DROP TABLE IF EXISTS `Category`;
DROP TABLE IF EXISTS `Brand`;
DROP TABLE IF EXISTS `Address`;
DROP TABLE IF EXISTS `User`;

SET FOREIGN_KEY_CHECKS = 1;

CREATE TABLE `User`(
    `id` CHAR(36) NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `email` VARCHAR(255) NOT NULL,
    `password` VARCHAR(255) NOT NULL,
    `phoneNumber` VARCHAR(255) NOT NULL,
    `createdAt` DATETIME NOT NULL,
    `updatedAt` DATETIME NOT NULL,
    `isActive` BOOLEAN NOT NULL,
    PRIMARY KEY(`id`),
    UNIQUE `user_email_unique`(`email`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE `Address`(
    `id` CHAR(36) NOT NULL,
    `uid` CHAR(36) NOT NULL,
    `type` VARCHAR(255) NOT NULL,
    `street` VARCHAR(255) NOT NULL,
    `city` VARCHAR(255) NOT NULL,
    `postalCode` VARCHAR(255) NOT NULL,
    `country` VARCHAR(255) NOT NULL,
    `isDefault` BOOLEAN NOT NULL,
    PRIMARY KEY(`id`),
    KEY `address_uid_index`(`uid`),
    CONSTRAINT `address_uid_foreign` FOREIGN KEY(`uid`) REFERENCES `User`(`id`) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE `Brand`(
    `id` CHAR(36) NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    PRIMARY KEY(`id`),
    UNIQUE `brand_name_unique`(`name`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE `Category`(
    `id` CHAR(36) NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `parentId` CHAR(36) NULL,
    PRIMARY KEY(`id`),
    KEY `category_parentid_index`(`parentId`),
    CONSTRAINT `category_parentid_foreign` FOREIGN KEY(`parentId`) REFERENCES `Category`(`id`) ON DELETE SET NULL
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE `Product`(
    `id` CHAR(36) NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `description` TEXT NOT NULL,
    `reference` VARCHAR(255) NOT NULL,
    `brandId` CHAR(36) NOT NULL,
    PRIMARY KEY(`id`),
    UNIQUE `product_reference_unique`(`reference`),
    KEY `product_brandid_index`(`brandId`),
    CONSTRAINT `product_brandid_foreign` FOREIGN KEY(`brandId`) REFERENCES `Brand`(`id`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE `ProductCategory`(
    `productId` CHAR(36) NOT NULL,
    `categoryId` CHAR(36) NOT NULL,
    UNIQUE `productcategory_productid_categoryid_unique`(`productId`, `categoryId`),
    KEY `productcategory_categoryid_index`(`categoryId`),
    CONSTRAINT `productcategory_productid_foreign` FOREIGN KEY(`productId`) REFERENCES `Product`(`id`) ON DELETE CASCADE,
    CONSTRAINT `productcategory_categoryid_foreign` FOREIGN KEY(`categoryId`) REFERENCES `Category`(`id`) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE `ProductVariant`(
    `id` CHAR(36) NOT NULL,
    `productId` CHAR(36) NOT NULL,
    `reference` VARCHAR(255) NOT NULL,
    `size` VARCHAR(255) NULL,
    `color` VARCHAR(255) NULL,
    PRIMARY KEY(`id`),
    UNIQUE `productvariant_reference_unique`(`reference`),
    KEY `productvariant_productid_index`(`productId`),
    CONSTRAINT `productvariant_productid_foreign` FOREIGN KEY(`productId`) REFERENCES `Product`(`id`) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE `PriceHistory`(
    `id` CHAR(36) NOT NULL,
    `productVariantId` CHAR(36) NOT NULL,
    `price` DECIMAL(8, 2) NOT NULL,
    `startDate` DATETIME NOT NULL,
    `endDate` DATETIME NULL,
    `currency` VARCHAR(255) NOT NULL,
    PRIMARY KEY(`id`),
    KEY `pricehistory_variant_index`(`productVariantId`, `startDate`),
    CONSTRAINT `pricehistory_productvariantid_foreign` FOREIGN KEY(`productVariantId`) REFERENCES `ProductVariant`(`id`) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE `Cart`(
    `id` CHAR(36) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `createdAt` DATETIME NOT NULL,
    `updatedAt` DATETIME NOT NULL,
    PRIMARY KEY(`id`),
    UNIQUE `cart_userid_unique`(`userId`),
    CONSTRAINT `cart_userid_foreign` FOREIGN KEY(`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE `CartItem`(
    `id` CHAR(36) NOT NULL,
    `cartId` CHAR(36) NOT NULL,
    `productVariantId` CHAR(36) NOT NULL,
    `quantity` INT NOT NULL,
    PRIMARY KEY(`id`),
    UNIQUE `cartitem_cartid_productvariantid_unique`(`cartId`, `productVariantId`),
    KEY `cartitem_productvariantid_index`(`productVariantId`),
    CONSTRAINT `cartitem_cartid_foreign` FOREIGN KEY(`cartId`) REFERENCES `Cart`(`id`) ON DELETE CASCADE,
    CONSTRAINT `cartitem_productvariantid_foreign` FOREIGN KEY(`productVariantId`) REFERENCES `ProductVariant`(`id`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE `Promotion`(
    `id` CHAR(36) NOT NULL,
    `code` VARCHAR(255) NOT NULL,
    `discountType` VARCHAR(255) NOT NULL,
    `discountValue` DECIMAL(8, 2) NOT NULL,
    `scope` VARCHAR(255) NOT NULL,
    `startDate` DATETIME NOT NULL,
    `endDate` DATETIME NOT NULL,
    `maxUses` INT NULL,
    `userId` CHAR(36) NULL,
    `maxUsesPerUser` INT NULL,
    PRIMARY KEY(`id`),
    UNIQUE `promotion_code_unique`(`code`),
    KEY `promotion_userid_index`(`userId`),
    CONSTRAINT `promotion_userid_foreign` FOREIGN KEY(`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE `PromotionTarget`(
    `promotionId` CHAR(36) NOT NULL,
    `productId` CHAR(36) NULL,
    `categoryId` CHAR(36) NULL,
    KEY `promotiontarget_promotionid_index`(`promotionId`),
    KEY `promotiontarget_productid_index`(`productId`),
    KEY `promotiontarget_categoryid_index`(`categoryId`),
    CONSTRAINT `promotiontarget_promotionid_foreign` FOREIGN KEY(`promotionId`) REFERENCES `Promotion`(`id`) ON DELETE CASCADE,
    CONSTRAINT `promotiontarget_productid_foreign` FOREIGN KEY(`productId`) REFERENCES `Product`(`id`) ON DELETE CASCADE,
    CONSTRAINT `promotiontarget_categoryid_foreign` FOREIGN KEY(`categoryId`) REFERENCES `Category`(`id`) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE `Order`(
    `id` CHAR(36) NOT NULL,
    `userId` CHAR(36) NULL,
    `orderNumber` VARCHAR(255) NOT NULL,
    `orderDate` DATETIME NOT NULL,
    `status` VARCHAR(255) NOT NULL,
    `currency` VARCHAR(255) NOT NULL,
    `guestName` VARCHAR(255) NULL,
    `guestEmail` VARCHAR(255) NULL,
    `guestPhoneNumber` VARCHAR(255) NULL,
    `shippingStreet` VARCHAR(255) NOT NULL,
    `shippingCity` VARCHAR(255) NOT NULL,
    `shippingPostalCode` VARCHAR(255) NOT NULL,
    `shippingCountry` VARCHAR(255) NOT NULL,
    `promotionId` CHAR(36) NULL,
    PRIMARY KEY(`id`),
    UNIQUE `order_ordernumber_unique`(`orderNumber`),
    KEY `order_userid_index`(`userId`),
    KEY `order_promotionid_index`(`promotionId`),
    CONSTRAINT `order_userid_foreign` FOREIGN KEY(`userId`) REFERENCES `User`(`id`) ON DELETE SET NULL,
    CONSTRAINT `order_promotionid_foreign` FOREIGN KEY(`promotionId`) REFERENCES `Promotion`(`id`) ON DELETE SET NULL
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE `OrderItem`(
    `id` CHAR(36) NOT NULL,
    `orderId` CHAR(36) NOT NULL,
    `productVariantId` CHAR(36) NOT NULL,
    `quantity` INT NOT NULL,
    `unitPrice` DECIMAL(8, 2) NOT NULL,
    PRIMARY KEY(`id`),
    KEY `orderitem_orderid_index`(`orderId`),
    KEY `orderitem_productvariantid_index`(`productVariantId`),
    CONSTRAINT `orderitem_orderid_foreign` FOREIGN KEY(`orderId`) REFERENCES `Order`(`id`) ON DELETE CASCADE,
    CONSTRAINT `orderitem_productvariantid_foreign` FOREIGN KEY(`productVariantId`) REFERENCES `ProductVariant`(`id`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;
