-- AlterTable
ALTER TABLE `LeaveLedger` ADD COLUMN `absenceId` INTEGER NULL;

-- AlterTable
ALTER TABLE `SyncRun` ADD COLUMN `absences` INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE `Absence` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `source` VARCHAR(10) NOT NULL,
    `externalId` VARCHAR(128) NOT NULL,
    `userId` INTEGER NOT NULL,
    `category` VARCHAR(8) NOT NULL,
    `typeName` VARCHAR(50) NULL,
    `typeCode` VARCHAR(20) NULL,
    `startAt` DATETIME(3) NULL,
    `endAt` DATETIME(3) NULL,
    `startDate` VARCHAR(10) NOT NULL,
    `endDate` VARCHAR(10) NOT NULL,
    `days` DECIMAL(6, 2) NULL,
    `hours` DECIMAL(7, 2) NULL,
    `status` VARCHAR(10) NOT NULL DEFAULT 'APPROVED',
    `approvalId` VARCHAR(64) NULL,
    `raw` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Absence_userId_startDate_idx`(`userId`, `startDate`),
    INDEX `Absence_startDate_endDate_idx`(`startDate`, `endDate`),
    UNIQUE INDEX `Absence_source_externalId_key`(`source`, `externalId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `LeaveLedger_absenceId_idx` ON `LeaveLedger`(`absenceId`);
