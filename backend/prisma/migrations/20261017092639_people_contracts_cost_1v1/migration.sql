-- AlterTable
ALTER TABLE `Employee` ADD COLUMN `birthDate` DATE NULL,
    ADD COLUMN `education` VARCHAR(10) NULL,
    ADD COLUMN `employmentType` VARCHAR(12) NULL,
    ADD COLUMN `gender` VARCHAR(1) NULL,
    ADD COLUMN `leaveDate` DATE NULL,
    ADD COLUMN `level` VARCHAR(20) NULL,
    ADD COLUMN `major` VARCHAR(100) NULL,
    ADD COLUMN `regularDate` DATE NULL,
    ADD COLUMN `school` VARCHAR(100) NULL,
    ADD COLUMN `tags` JSON NULL;

-- CreateTable
CREATE TABLE `Contract` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `kind` VARCHAR(16) NOT NULL,
    `title` VARCHAR(100) NULL,
    `number` VARCHAR(50) NULL,
    `term` VARCHAR(5) NOT NULL DEFAULT 'FIXED',
    `signedDate` VARCHAR(10) NULL,
    `startDate` VARCHAR(10) NOT NULL,
    `endDate` VARCHAR(10) NULL,
    `probationEnd` VARCHAR(10) NULL,
    `restrictMonths` INTEGER NULL,
    `monthlyComp` DECIMAL(12, 2) NULL,
    `serviceMonths` INTEGER NULL,
    `penalty` DECIMAL(12, 2) NULL,
    `fileKey` VARCHAR(500) NULL,
    `fileName` VARCHAR(200) NULL,
    `fileSize` INTEGER NULL,
    `renewOfId` INTEGER NULL,
    `terminatedAt` VARCHAR(10) NULL,
    `terminateReason` VARCHAR(300) NULL,
    `note` VARCHAR(1000) NULL,
    `createdBy` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,

    INDEX `Contract_userId_kind_idx`(`userId`, `kind`),
    INDEX `Contract_endDate_idx`(`endDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CostProfile` (
    `userId` INTEGER NOT NULL,
    `salary` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `social` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `housing` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `benefit` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `note` VARCHAR(300) NULL,
    `updatedBy` INTEGER NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CostItem` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `month` VARCHAR(7) NOT NULL,
    `category` VARCHAR(12) NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `source` VARCHAR(8) NOT NULL DEFAULT 'MANUAL',
    `note` VARCHAR(300) NULL,
    `updatedBy` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `CostItem_month_idx`(`month`),
    UNIQUE INDEX `CostItem_userId_month_category_key`(`userId`, `month`, `category`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `OneOnOne` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `managerId` INTEGER NOT NULL,
    `date` VARCHAR(10) NOT NULL,
    `minutes` INTEGER NULL,
    `mood` INTEGER NULL,
    `topics` JSON NULL,
    `notes` TEXT NULL,
    `privateNote` TEXT NULL,
    `actions` JSON NULL,
    `nextDate` VARCHAR(10) NULL,
    `shared` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,

    INDEX `OneOnOne_userId_date_idx`(`userId`, `date`),
    INDEX `OneOnOne_managerId_date_idx`(`managerId`, `date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
