-- AlterTable
ALTER TABLE `OneOnOne` ADD COLUMN `parsed` JSON NULL,
    ADD COLUMN `sourceFileKey` VARCHAR(500) NULL,
    ADD COLUMN `sourceFileName` VARCHAR(200) NULL,
    ADD COLUMN `sourceFileSize` INTEGER NULL,
    ADD COLUMN `sourceShared` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `sourceText` MEDIUMTEXT NULL;
