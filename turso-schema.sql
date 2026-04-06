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
CREATE TABLE "BlitzRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requestedById" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'create',
    "blitzId" TEXT,
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
    CONSTRAINT "BlitzRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "BlitzRequest_blitzId_fkey" FOREIGN KEY ("blitzId") REFERENCES "Blitz" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE TABLE "Financer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
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
CREATE TABLE "IncentiveMilestone" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "incentiveId" TEXT NOT NULL,
    "threshold" REAL NOT NULL,
    "reward" TEXT NOT NULL,
    "achieved" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "IncentiveMilestone_incentiveId_fkey" FOREIGN KEY ("incentiveId") REFERENCES "Incentive" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE "Installer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "installPayPct" INTEGER NOT NULL DEFAULT 80,
    "usesProductCatalog" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
CREATE TABLE "InstallerPrepaidOption" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "installerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "InstallerPrepaidOption_installerId_fkey" FOREIGN KEY ("installerId") REFERENCES "Installer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
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
CREATE TABLE "ProductPricingTier" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "versionId" TEXT NOT NULL,
    "minKW" REAL NOT NULL,
    "maxKW" REAL,
    "closerPerW" REAL NOT NULL,
    "setterPerW" REAL NOT NULL,
    "kiloPerW" REAL NOT NULL, "subDealerPerW" REAL,
    CONSTRAINT "ProductPricingTier_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "ProductPricingVersion" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
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
    "m3Paid" BOOLEAN NOT NULL DEFAULT false,
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
CREATE TABLE "ProjectActivity" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "meta" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProjectActivity_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE "ProjectCheckItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "messageId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "completedBy" TEXT,
    "completedAt" DATETIME, "dueDate" DATETIME,
    CONSTRAINT "ProjectCheckItem_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "ProjectMessage" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE "ProjectMention" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "messageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "readAt" DATETIME,
    CONSTRAINT "ProjectMention_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "ProjectMessage" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
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
CREATE TABLE "TrainerOverrideTier" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "assignmentId" TEXT NOT NULL,
    "upToDeal" INTEGER,
    "ratePerW" REAL NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "TrainerOverrideTier_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "TrainerAssignment" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
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
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE INDEX "User_role_idx" ON "User"("role");
CREATE INDEX "User_active_idx" ON "User"("active");
CREATE UNIQUE INDEX "Installer_name_key" ON "Installer"("name");
CREATE INDEX "Installer_active_idx" ON "Installer"("active");
CREATE UNIQUE INDEX "InstallerPrepaidOption_installerId_name_key" ON "InstallerPrepaidOption"("installerId", "name");
CREATE UNIQUE INDEX "Financer_name_key" ON "Financer"("name");
CREATE INDEX "InstallerPricingVersion_installerId_effectiveFrom_idx" ON "InstallerPricingVersion"("installerId", "effectiveFrom");
CREATE UNIQUE INDEX "ProductCatalogConfig_installerId_key" ON "ProductCatalogConfig"("installerId");
CREATE INDEX "Product_installerId_family_idx" ON "Product"("installerId", "family");
CREATE INDEX "Product_installerId_active_idx" ON "Product"("installerId", "active");
CREATE INDEX "ProductPricingVersion_productId_effectiveFrom_idx" ON "ProductPricingVersion"("productId", "effectiveFrom");
CREATE INDEX "ProductPricingTier_versionId_idx" ON "ProductPricingTier"("versionId");
CREATE INDEX "PayrollEntry_repId_idx" ON "PayrollEntry"("repId");
CREATE INDEX "PayrollEntry_projectId_idx" ON "PayrollEntry"("projectId");
CREATE INDEX "PayrollEntry_status_idx" ON "PayrollEntry"("status");
CREATE INDEX "PayrollEntry_date_idx" ON "PayrollEntry"("date");
CREATE INDEX "Reimbursement_repId_idx" ON "Reimbursement"("repId");
CREATE INDEX "Reimbursement_status_idx" ON "Reimbursement"("status");
CREATE INDEX "TrainerAssignment_trainerId_idx" ON "TrainerAssignment"("trainerId");
CREATE INDEX "TrainerAssignment_traineeId_idx" ON "TrainerAssignment"("traineeId");
CREATE UNIQUE INDEX "TrainerAssignment_trainerId_traineeId_key" ON "TrainerAssignment"("trainerId", "traineeId");
CREATE INDEX "TrainerOverrideTier_assignmentId_idx" ON "TrainerOverrideTier"("assignmentId");
CREATE INDEX "Incentive_active_idx" ON "Incentive"("active");
CREATE INDEX "Incentive_targetRepId_idx" ON "Incentive"("targetRepId");
CREATE INDEX "Incentive_blitzId_idx" ON "Incentive"("blitzId");
CREATE INDEX "IncentiveMilestone_incentiveId_idx" ON "IncentiveMilestone"("incentiveId");
CREATE INDEX "Blitz_status_idx" ON "Blitz"("status");
CREATE INDEX "Blitz_ownerId_idx" ON "Blitz"("ownerId");
CREATE INDEX "Blitz_startDate_idx" ON "Blitz"("startDate");
CREATE INDEX "BlitzParticipant_blitzId_idx" ON "BlitzParticipant"("blitzId");
CREATE INDEX "BlitzParticipant_userId_idx" ON "BlitzParticipant"("userId");
CREATE UNIQUE INDEX "BlitzParticipant_blitzId_userId_key" ON "BlitzParticipant"("blitzId", "userId");
CREATE INDEX "BlitzCost_blitzId_idx" ON "BlitzCost"("blitzId");
CREATE INDEX "ProjectActivity_projectId_idx" ON "ProjectActivity"("projectId");
CREATE INDEX "Project_closerId_idx" ON "Project"("closerId");
CREATE INDEX "Project_setterId_idx" ON "Project"("setterId");
CREATE INDEX "Project_subDealerId_idx" ON "Project"("subDealerId");
CREATE INDEX "Project_installerId_idx" ON "Project"("installerId");
CREATE INDEX "Project_phase_idx" ON "Project"("phase");
CREATE INDEX "Project_soldDate_idx" ON "Project"("soldDate");
CREATE INDEX "Project_blitzId_idx" ON "Project"("blitzId");
CREATE INDEX "InstallerPricingTier_versionId_idx" ON "InstallerPricingTier"("versionId");
CREATE INDEX "ProjectMessage_projectId_idx" ON "ProjectMessage"("projectId");
CREATE INDEX "ProjectCheckItem_messageId_idx" ON "ProjectCheckItem"("messageId");
CREATE INDEX "ProjectMention_messageId_idx" ON "ProjectMention"("messageId");
CREATE INDEX "ProjectMention_userId_idx" ON "ProjectMention"("userId");
CREATE INDEX "BlitzRequest_requestedById_idx" ON "BlitzRequest"("requestedById");
CREATE INDEX "BlitzRequest_status_idx" ON "BlitzRequest"("status");
