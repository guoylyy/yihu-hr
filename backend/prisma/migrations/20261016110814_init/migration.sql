-- CreateTable
CREATE TABLE `Employee` (
    `id` INTEGER NOT NULL,
    `name` VARCHAR(50) NOT NULL,
    `jobNumber` VARCHAR(50) NULL,
    `title` VARCHAR(100) NULL,
    `avatar` VARCHAR(500) NULL,
    `spaceId` INTEGER NOT NULL DEFAULT 1,
    `deptId` INTEGER NULL,
    `deptPath` VARCHAR(300) NULL,
    `depts` JSON NULL,
    `leaderOf` JSON NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `dingUserId` VARCHAR(64) NULL,
    `feishuOpenId` VARCHAR(64) NULL,
    `feishuUserId` VARCHAR(64) NULL,
    `wecomUserId` VARCHAR(64) NULL,
    `hireDate` DATE NULL,
    `workStartDate` DATE NULL,
    `approverId` INTEGER NULL,
    `syncedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Employee_deptId_idx`(`deptId`),
    INDEX `Employee_dingUserId_idx`(`dingUserId`),
    INDEX `Employee_feishuOpenId_idx`(`feishuOpenId`),
    INDEX `Employee_wecomUserId_idx`(`wecomUserId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RoleMember` (
    `userId` INTEGER NOT NULL,
    `role` VARCHAR(20) NOT NULL,
    `createdBy` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`userId`, `role`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Punch` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `source` VARCHAR(10) NOT NULL,
    `externalId` VARCHAR(128) NOT NULL,
    `userId` INTEGER NOT NULL,
    `workDate` VARCHAR(10) NOT NULL,
    `kind` VARCHAR(10) NOT NULL,
    `checkTime` DATETIME(3) NULL,
    `planTime` DATETIME(3) NULL,
    `result` VARCHAR(16) NOT NULL,
    `location` VARCHAR(200) NULL,
    `note` VARCHAR(500) NULL,
    `createdBy` INTEGER NULL,
    `raw` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Punch_userId_workDate_idx`(`userId`, `workDate`),
    INDEX `Punch_workDate_idx`(`workDate`),
    UNIQUE INDEX `Punch_source_externalId_key`(`source`, `externalId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SyncRun` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `source` VARCHAR(10) NOT NULL,
    `trigger` VARCHAR(10) NOT NULL,
    `dateFrom` VARCHAR(10) NULL,
    `dateTo` VARCHAR(10) NULL,
    `ok` BOOLEAN NULL,
    `fetched` INTEGER NOT NULL DEFAULT 0,
    `saved` INTEGER NOT NULL DEFAULT 0,
    `unmatched` INTEGER NOT NULL DEFAULT 0,
    `error` TEXT NULL,
    `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `finishedAt` DATETIME(3) NULL,

    INDEX `SyncRun_source_startedAt_idx`(`source`, `startedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LeaveType` (
    `code` VARCHAR(20) NOT NULL,
    `name` VARCHAR(30) NOT NULL,
    `paid` BOOLEAN NOT NULL DEFAULT true,
    `balanced` BOOLEAN NOT NULL DEFAULT false,
    `unit` VARCHAR(5) NOT NULL DEFAULT 'HALF',
    `active` BOOLEAN NOT NULL DEFAULT true,
    `sort` INTEGER NOT NULL DEFAULT 0,
    `note` VARCHAR(200) NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`code`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LeaveRequest` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `typeCode` VARCHAR(20) NOT NULL,
    `startDate` VARCHAR(10) NOT NULL,
    `startHalf` VARCHAR(2) NOT NULL DEFAULT 'AM',
    `endDate` VARCHAR(10) NOT NULL,
    `endHalf` VARCHAR(2) NOT NULL DEFAULT 'PM',
    `days` DECIMAL(6, 1) NOT NULL,
    `reason` VARCHAR(500) NULL,
    `status` VARCHAR(10) NOT NULL DEFAULT 'PENDING',
    `approverId` INTEGER NULL,
    `decidedBy` INTEGER NULL,
    `decidedAt` DATETIME(3) NULL,
    `decisionNote` VARCHAR(500) NULL,
    `via` VARCHAR(5) NOT NULL DEFAULT 'WEB',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `LeaveRequest_userId_startDate_idx`(`userId`, `startDate`),
    INDEX `LeaveRequest_status_approverId_idx`(`status`, `approverId`),
    INDEX `LeaveRequest_startDate_endDate_idx`(`startDate`, `endDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LeaveLedger` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `year` INTEGER NOT NULL,
    `typeCode` VARCHAR(20) NOT NULL,
    `delta` DECIMAL(6, 1) NOT NULL,
    `kind` VARCHAR(12) NOT NULL,
    `requestId` INTEGER NULL,
    `note` VARCHAR(300) NULL,
    `createdBy` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `LeaveLedger_userId_year_typeCode_idx`(`userId`, `year`, `typeCode`),
    INDEX `LeaveLedger_requestId_idx`(`requestId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Holiday` (
    `date` VARCHAR(10) NOT NULL,
    `kind` VARCHAR(8) NOT NULL,
    `name` VARCHAR(50) NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`date`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Setting` (
    `key` VARCHAR(64) NOT NULL,
    `value` JSON NOT NULL,
    `updatedBy` INTEGER NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AuditLog` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `actorId` INTEGER NULL,
    `via` VARCHAR(6) NOT NULL,
    `action` VARCHAR(40) NOT NULL,
    `entityType` VARCHAR(20) NULL,
    `entityId` VARCHAR(40) NULL,
    `detail` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AuditLog_entityType_entityId_idx`(`entityType`, `entityId`),
    INDEX `AuditLog_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
