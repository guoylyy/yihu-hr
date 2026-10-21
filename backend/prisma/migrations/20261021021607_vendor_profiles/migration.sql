-- AlterTable
ALTER TABLE `Employee` ADD COLUMN `vendorSnapshot` JSON NULL;

-- CreateTable
CREATE TABLE `ProfileChange` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `source` VARCHAR(10) NOT NULL,
    `field` VARCHAR(20) NOT NULL,
    `before` VARCHAR(200) NULL,
    `after` VARCHAR(200) NULL,
    `kind` VARCHAR(10) NOT NULL,
    `resolution` VARCHAR(6) NULL,
    `resolvedBy` INTEGER NULL,
    `resolvedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ProfileChange_kind_createdAt_idx`(`kind`, `createdAt`),
    INDEX `ProfileChange_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
