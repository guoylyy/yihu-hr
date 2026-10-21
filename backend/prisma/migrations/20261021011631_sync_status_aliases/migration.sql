-- AlterTable
ALTER TABLE `SyncRun` ADD COLUMN `absenceError` TEXT NULL,
    ADD COLUMN `absenceFrom` VARCHAR(10) NULL,
    ADD COLUMN `absenceOk` BOOLEAN NULL,
    ADD COLUMN `absenceTo` VARCHAR(10) NULL;

-- CreateTable
CREATE TABLE `SyncSeen` (
    `source` VARCHAR(10) NOT NULL,
    `key` VARCHAR(128) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`source`, `key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `NameAlias` (
    `alias` VARCHAR(50) NOT NULL,
    `userId` INTEGER NOT NULL,
    `createdBy` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `NameAlias_userId_idx`(`userId`),
    PRIMARY KEY (`alias`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
