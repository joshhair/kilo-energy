-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL DEFAULT '',
    "role" TEXT NOT NULL DEFAULT 'rep',
    "repType" TEXT NOT NULL DEFAULT 'both',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "canRequestBlitz" BOOLEAN NOT NULL DEFAULT false,
    "canCreateBlitz" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Installer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "installPayPct" INTEGER NOT NULL DEFAULT 80,
    "usesProductCatalog" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "InstallerPrepaidOption" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "installerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "InstallerPrepaidOption_installerId_fkey" FOREIGN KEY ("installerId") REFERENCES "Installer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Financer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "InstallerPricingVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "installerId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "effectiveFrom" TEXT NOT NULL,
    "effectiveTo" TEXT,
    "rateType" TEXT NOT NULL DEFAULT 'flat',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "InstallerPricingVersion_installerId_fkey" FOREIGN KEY ("installerId") REFERENCES "Installer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InstallerPricingTier" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "versionId" TEXT NOT NULL,
    "minKW" REAL NOT NULL DEFAULT 0,
    "maxKW" REAL,
    "closerPerW" REAL NOT NULL,
    "setterPerW" REAL,
    "kiloPerW" REAL NOT NULL,
    "subDealerPerW" REAL,
    CONSTRAINT "InstallerPricingTier_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "InstallerPricingVersion" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProductCatalogConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "installerId" TEXT NOT NULL,
    "families" TEXT NOT NULL DEFAULT '',
    "familyFinancerMap" TEXT NOT NULL DEFAULT '{}',
    "prepaidFamily" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProductCatalogConfig_installerId_fkey" FOREIGN KEY ("installerId") REFERENCES "Installer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "installerId" TEXT NOT NULL,
    "family" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Product_installerId_fkey" FOREIGN KEY ("installerId") REFERENCES "Installer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProductPricingVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "productId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "effectiveFrom" TEXT NOT NULL,
    "effectiveTo" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProductPricingVersion_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProductPricingTier" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "versionId" TEXT NOT NULL,
    "minKW" REAL NOT NULL,
    "maxKW" REAL,
    "closerPerW" REAL NOT NULL,
    "setterPerW" REAL NOT NULL,
    "kiloPerW" REAL NOT NULL,
    "subDealerPerW" REAL,
    CONSTRAINT "ProductPricingTier_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "ProductPricingVersion" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "customerName" TEXT NOT NULL,
    "closerId" TEXT NOT NULL,
    "setterId" TEXT,
    "subDealerId" TEXT,
    "soldDate" TEXT NOT NULL,
    "installerId" TEXT NOT NULL,
    "financerId" TEXT NOT NULL,
    "productType" TEXT NOT NULL,
    "kWSize" REAL NOT NULL,
    "netPPW" REAL NOT NULL,
    "phase" TEXT NOT NULL DEFAULT 'New',
    "m1Paid" BOOLEAN NOT NULL DEFAULT false,
    "m1Amount" REAL NOT NULL DEFAULT 0,
    "m2Paid" BOOLEAN NOT NULL DEFAULT false,
    "m2Amount" REAL NOT NULL DEFAULT 0,
    "m3Amount" REAL,
    "notes" TEXT NOT NULL DEFAULT '',
    "flagged" BOOLEAN NOT NULL DEFAULT false,
    "installerPricingVersionId" TEXT,
    "productId" TEXT,
    "productPricingVersionId" TEXT,
    "baselineOverrideJson" TEXT,
    "prepaidSubType" TEXT,
    "leadSource" TEXT,
    "blitzId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Project_closerId_fkey" FOREIGN KEY ("closerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Project_setterId_fkey" FOREIGN KEY ("setterId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Project_subDealerId_fkey" FOREIGN KEY ("subDealerId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Project_installerId_fkey" FOREIGN KEY ("installerId") REFERENCES "Installer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Project_financerId_fkey" FOREIGN KEY ("financerId") REFERENCES "Financer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Project_installerPricingVersionId_fkey" FOREIGN KEY ("installerPricingVersionId") REFERENCES "InstallerPricingVersion" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Project_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Project_productPricingVersionId_fkey" FOREIGN KEY ("productPricingVersionId") REFERENCES "ProductPricingVersion" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Project_blitzId_fkey" FOREIGN KEY ("blitzId") REFERENCES "Blitz" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProjectActivity" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "meta" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProjectActivity_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PayrollEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "repId" TEXT NOT NULL,
    "projectId" TEXT,
    "amount" REAL NOT NULL,
    "type" TEXT NOT NULL,
    "paymentStage" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "date" TEXT NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PayrollEntry_repId_fkey" FOREIGN KEY ("repId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PayrollEntry_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Reimbursement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "repId" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "description" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "receiptName" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Reimbursement_repId_fkey" FOREIGN KEY ("repId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TrainerAssignment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "trainerId" TEXT NOT NULL,
    "traineeId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TrainerAssignment_trainerId_fkey" FOREIGN KEY ("trainerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TrainerAssignment_traineeId_fkey" FOREIGN KEY ("traineeId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TrainerOverrideTier" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "assignmentId" TEXT NOT NULL,
    "upToDeal" INTEGER,
    "ratePerW" REAL NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "TrainerOverrideTier_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "TrainerAssignment" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Incentive" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "type" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "startDate" TEXT NOT NULL,
    "endDate" TEXT,
    "targetRepId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "blitzId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Incentive_targetRepId_fkey" FOREIGN KEY ("targetRepId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Incentive_blitzId_fkey" FOREIGN KEY ("blitzId") REFERENCES "Blitz" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "IncentiveMilestone" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "incentiveId" TEXT NOT NULL,
    "threshold" REAL NOT NULL,
    "reward" TEXT NOT NULL,
    "achieved" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "IncentiveMilestone_incentiveId_fkey" FOREIGN KEY ("incentiveId") REFERENCES "Incentive" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Blitz" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "location" TEXT NOT NULL DEFAULT '',
    "housing" TEXT NOT NULL DEFAULT '',
    "startDate" TEXT NOT NULL,
    "endDate" TEXT NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'upcoming',
    "createdById" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Blitz_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Blitz_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BlitzParticipant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "blitzId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "joinStatus" TEXT NOT NULL DEFAULT 'pending',
    "attendanceStatus" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BlitzParticipant_blitzId_fkey" FOREIGN KEY ("blitzId") REFERENCES "Blitz" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BlitzParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BlitzCost" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "blitzId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "date" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BlitzCost_blitzId_fkey" FOREIGN KEY ("blitzId") REFERENCES "Blitz" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProjectMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "authorRole" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProjectMessage_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProjectCheckItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "messageId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "completedBy" TEXT,
    "completedAt" DATETIME,
    "dueDate" DATETIME,
    CONSTRAINT "ProjectCheckItem_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "ProjectMessage" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProjectMention" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "messageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "readAt" DATETIME,
    CONSTRAINT "ProjectMention_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "ProjectMessage" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BlitzRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requestedById" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "location" TEXT NOT NULL DEFAULT '',
    "startDate" TEXT NOT NULL,
    "endDate" TEXT NOT NULL,
    "housing" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "expectedHeadcount" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "adminNotes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BlitzRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE INDEX "User_active_idx" ON "User"("active");

-- CreateIndex
CREATE UNIQUE INDEX "Installer_name_key" ON "Installer"("name");

-- CreateIndex
CREATE INDEX "Installer_active_idx" ON "Installer"("active");

-- CreateIndex
CREATE UNIQUE INDEX "InstallerPrepaidOption_installerId_name_key" ON "InstallerPrepaidOption"("installerId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Financer_name_key" ON "Financer"("name");

-- CreateIndex
CREATE INDEX "InstallerPricingVersion_installerId_effectiveFrom_idx" ON "InstallerPricingVersion"("installerId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "InstallerPricingTier_versionId_idx" ON "InstallerPricingTier"("versionId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductCatalogConfig_installerId_key" ON "ProductCatalogConfig"("installerId");

-- CreateIndex
CREATE INDEX "Product_installerId_family_idx" ON "Product"("installerId", "family");

-- CreateIndex
CREATE INDEX "Product_installerId_active_idx" ON "Product"("installerId", "active");

-- CreateIndex
CREATE INDEX "ProductPricingVersion_productId_effectiveFrom_idx" ON "ProductPricingVersion"("productId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "ProductPricingTier_versionId_idx" ON "ProductPricingTier"("versionId");

-- CreateIndex
CREATE INDEX "Project_closerId_idx" ON "Project"("closerId");

-- CreateIndex
CREATE INDEX "Project_setterId_idx" ON "Project"("setterId");

-- CreateIndex
CREATE INDEX "Project_subDealerId_idx" ON "Project"("subDealerId");

-- CreateIndex
CREATE INDEX "Project_installerId_idx" ON "Project"("installerId");

-- CreateIndex
CREATE INDEX "Project_phase_idx" ON "Project"("phase");

-- CreateIndex
CREATE INDEX "Project_soldDate_idx" ON "Project"("soldDate");

-- CreateIndex
CREATE INDEX "Project_blitzId_idx" ON "Project"("blitzId");

-- CreateIndex
CREATE INDEX "ProjectActivity_projectId_idx" ON "ProjectActivity"("projectId");

-- CreateIndex
CREATE INDEX "PayrollEntry_repId_idx" ON "PayrollEntry"("repId");

-- CreateIndex
CREATE INDEX "PayrollEntry_projectId_idx" ON "PayrollEntry"("projectId");

-- CreateIndex
CREATE INDEX "PayrollEntry_status_idx" ON "PayrollEntry"("status");

-- CreateIndex
CREATE INDEX "PayrollEntry_date_idx" ON "PayrollEntry"("date");

-- CreateIndex
CREATE INDEX "Reimbursement_repId_idx" ON "Reimbursement"("repId");

-- CreateIndex
CREATE INDEX "Reimbursement_status_idx" ON "Reimbursement"("status");

-- CreateIndex
CREATE INDEX "TrainerAssignment_trainerId_idx" ON "TrainerAssignment"("trainerId");

-- CreateIndex
CREATE INDEX "TrainerAssignment_traineeId_idx" ON "TrainerAssignment"("traineeId");

-- CreateIndex
CREATE UNIQUE INDEX "TrainerAssignment_trainerId_traineeId_key" ON "TrainerAssignment"("trainerId", "traineeId");

-- CreateIndex
CREATE INDEX "TrainerOverrideTier_assignmentId_idx" ON "TrainerOverrideTier"("assignmentId");

-- CreateIndex
CREATE INDEX "Incentive_active_idx" ON "Incentive"("active");

-- CreateIndex
CREATE INDEX "Incentive_targetRepId_idx" ON "Incentive"("targetRepId");

-- CreateIndex
CREATE INDEX "Incentive_blitzId_idx" ON "Incentive"("blitzId");

-- CreateIndex
CREATE INDEX "IncentiveMilestone_incentiveId_idx" ON "IncentiveMilestone"("incentiveId");

-- CreateIndex
CREATE INDEX "Blitz_status_idx" ON "Blitz"("status");

-- CreateIndex
CREATE INDEX "Blitz_ownerId_idx" ON "Blitz"("ownerId");

-- CreateIndex
CREATE INDEX "Blitz_startDate_idx" ON "Blitz"("startDate");

-- CreateIndex
CREATE INDEX "BlitzParticipant_blitzId_idx" ON "BlitzParticipant"("blitzId");

-- CreateIndex
CREATE INDEX "BlitzParticipant_userId_idx" ON "BlitzParticipant"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "BlitzParticipant_blitzId_userId_key" ON "BlitzParticipant"("blitzId", "userId");

-- CreateIndex
CREATE INDEX "BlitzCost_blitzId_idx" ON "BlitzCost"("blitzId");

-- CreateIndex
CREATE INDEX "ProjectMessage_projectId_idx" ON "ProjectMessage"("projectId");

-- CreateIndex
CREATE INDEX "ProjectCheckItem_messageId_idx" ON "ProjectCheckItem"("messageId");

-- CreateIndex
CREATE INDEX "ProjectMention_messageId_idx" ON "ProjectMention"("messageId");

-- CreateIndex
CREATE INDEX "ProjectMention_userId_idx" ON "ProjectMention"("userId");

-- CreateIndex
CREATE INDEX "BlitzRequest_requestedById_idx" ON "BlitzRequest"("requestedById");

-- CreateIndex
CREATE INDEX "BlitzRequest_status_idx" ON "BlitzRequest"("status");

