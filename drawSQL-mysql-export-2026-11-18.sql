CREATE TABLE `User`(
    `id` CHAR(36) NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `email` VARCHAR(255) NOT NULL,
    `password` VARCHAR(255) NOT NULL,
    `phoneNumber` VARCHAR(255) NOT NULL,
    `createdAt` DATETIME NOT NULL,
    `updatedAt` DATETIME NOT NULL,
    `isActive` BOOLEAN NOT NULL,
    PRIMARY KEY(`id`)
);
ALTER TABLE
    `User` ADD UNIQUE `user_email_unique`(`email`);
CREATE TABLE `Address`(
    `id` CHAR(36) NOT NULL,
    `uid` CHAR(36) NOT NULL,
    `type` VARCHAR(255) NOT NULL,
    `street` VARCHAR(255) NOT NULL,
    `city` VARCHAR(255) NOT NULL,
    `postalCode` VARCHAR(255) NOT NULL,
    `country` VARCHAR(255) NOT NULL,
    `isDefault` BOOLEAN NOT NULL,
    PRIMARY KEY(`id`)
);
CREATE TABLE `Product`(
    `id` CHAR(36) NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `description` TEXT NOT NULL,
    `reference` VARCHAR(255) NOT NULL,
    `brandId` CHAR(36) NOT NULL,
    PRIMARY KEY(`id`)
);
ALTER TABLE
    `Product` ADD UNIQUE `product_reference_unique`(`reference`);
CREATE TABLE `Category`(
    `id` CHAR(36) NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `parentId` CHAR(36) NULL,
    PRIMARY KEY(`id`)
);
CREATE TABLE `ProductCategory`(
    `productId` CHAR(36) NOT NULL,
    `categoryId` CHAR(36) NOT NULL
);
ALTER TABLE
    `ProductCategory` ADD UNIQUE `productcategory_productid_categoryid_unique`(`productId`, `categoryId`);
CREATE TABLE `Brand`(
    `id` CHAR(36) NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    PRIMARY KEY(`id`)
);
ALTER TABLE
    `Brand` ADD UNIQUE `brand_name_unique`(`name`);
CREATE TABLE `ProductVariant`(
    `id` CHAR(36) NOT NULL,
    `productId` CHAR(36) NOT NULL,
    `reference` VARCHAR(255) NOT NULL,
    `size` VARCHAR(255) NULL,
    `color` VARCHAR(255) NULL,
    PRIMARY KEY(`id`)
);
ALTER TABLE
    `ProductVariant` ADD UNIQUE `productvariant_reference_unique`(`reference`);
CREATE TABLE `PriceHistory`(
    `id` CHAR(36) NOT NULL,
    `productVariantId` CHAR(36) NOT NULL,
    `price` DECIMAL(8, 2) NOT NULL,
    `startDate` DATETIME NOT NULL,
    `endDate` DATETIME NULL,
    `currency` VARCHAR(255) NOT NULL,
    PRIMARY KEY(`id`)
);
CREATE TABLE `Cart`(
    `id` CHAR(36) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `createdAt` DATETIME NOT NULL,
    `updatedAt` DATETIME NOT NULL,
    PRIMARY KEY(`id`)
);
ALTER TABLE
    `Cart` ADD UNIQUE `cart_userid_unique`(`userId`);
CREATE TABLE `CartItem`(
    `id` CHAR(36) NOT NULL,
    `cartId` CHAR(36) NOT NULL,
    `productVariantId` CHAR(36) NOT NULL,
    `quantity` INT NOT NULL,
    PRIMARY KEY(`id`)
);
ALTER TABLE
    `CartItem` ADD UNIQUE `cartitem_cartid_productvariantid_unique`(`cartId`, `productVariantId`);
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
    PRIMARY KEY(`id`)
);
ALTER TABLE
    `Order` ADD UNIQUE `order_ordernumber_unique`(`orderNumber`);
CREATE TABLE `OrderItem`(
    `id` CHAR(36) NOT NULL,
    `orderId` CHAR(36) NOT NULL,
    `productVariantId` CHAR(36) NOT NULL,
    `quantity` INT NOT NULL,
    `unitPrice` DECIMAL(8, 2) NOT NULL,
    PRIMARY KEY(`id`)
);
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
    PRIMARY KEY(`id`)
);
ALTER TABLE
    `Promotion` ADD UNIQUE `promotion_code_unique`(`code`);
CREATE TABLE `PromotionTarget`(
    `promotionId` CHAR(36) NOT NULL,
    `productId` CHAR(36) NULL,
    `categoryId` CHAR(36) NULL
);
ALTER TABLE
    `ProductCategory` ADD CONSTRAINT `productcategory_productid_foreign` FOREIGN KEY(`productId`) REFERENCES `Product`(`id`);
ALTER TABLE
    `ProductVariant` ADD CONSTRAINT `productvariant_productid_foreign` FOREIGN KEY(`productId`) REFERENCES `Product`(`id`);
ALTER TABLE
    `Product` ADD CONSTRAINT `product_brandid_foreign` FOREIGN KEY(`brandId`) REFERENCES `Brand`(`id`);
ALTER TABLE
    `PromotionTarget` ADD CONSTRAINT `promotiontarget_productid_foreign` FOREIGN KEY(`productId`) REFERENCES `Product`(`id`);
ALTER TABLE
    `Address` ADD CONSTRAINT `address_uid_foreign` FOREIGN KEY(`uid`) REFERENCES `User`(`id`);
ALTER TABLE
    `ProductCategory` ADD CONSTRAINT `productcategory_categoryid_foreign` FOREIGN KEY(`categoryId`) REFERENCES `Category`(`id`);
ALTER TABLE
    `Order` ADD CONSTRAINT `order_userid_foreign` FOREIGN KEY(`userId`) REFERENCES `User`(`id`);
ALTER TABLE
    `Promotion` ADD CONSTRAINT `promotion_userid_foreign` FOREIGN KEY(`userId`) REFERENCES `User`(`id`);
ALTER TABLE
    `PromotionTarget` ADD CONSTRAINT `promotiontarget_categoryid_foreign` FOREIGN KEY(`categoryId`) REFERENCES `Category`(`id`);
ALTER TABLE
    `CartItem` ADD CONSTRAINT `cartitem_cartid_foreign` FOREIGN KEY(`cartId`) REFERENCES `ProductVariant`(`productId`);
ALTER TABLE
    `Order` ADD CONSTRAINT `order_promotionid_foreign` FOREIGN KEY(`promotionId`) REFERENCES `PromotionTarget`(`promotionId`);
ALTER TABLE
    `OrderItem` ADD CONSTRAINT `orderitem_id_foreign` FOREIGN KEY(`id`) REFERENCES `Order`(`id`);
ALTER TABLE
    `PriceHistory` ADD CONSTRAINT `pricehistory_productvariantid_foreign` FOREIGN KEY(`productVariantId`) REFERENCES `ProductVariant`(`productId`);
ALTER TABLE
    `Cart` ADD CONSTRAINT `cart_userid_foreign` FOREIGN KEY(`userId`) REFERENCES `User`(`id`);
ALTER TABLE
    `OrderItem` ADD CONSTRAINT `orderitem_productvariantid_foreign` FOREIGN KEY(`productVariantId`) REFERENCES `ProductVariant`(`id`);
ALTER TABLE
    `PromotionTarget` ADD CONSTRAINT `promotiontarget_promotionid_foreign` FOREIGN KEY(`promotionId`) REFERENCES `Promotion`(`id`);
ALTER TABLE
    `CartItem` ADD CONSTRAINT `cartitem_id_foreign` FOREIGN KEY(`id`) REFERENCES `Cart`(`id`);
ALTER TABLE
    `Category` ADD CONSTRAINT `category_parentid_foreign` FOREIGN KEY(`parentId`) REFERENCES `Category`(`id`);