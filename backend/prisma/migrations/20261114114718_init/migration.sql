-- CreateEnum
CREATE TYPE "ClaimType" AS ENUM ('EFFICACY', 'PERCEPTION', 'INGREDIENT', 'SAFETY', 'ENVIRONMENTAL');

-- CreateEnum
CREATE TYPE "ClaimStatus" AS ENUM ('PROPOSED', 'SCREENED', 'IN_TESTING', 'EVIDENCE_SUBMITTED', 'ASSESSED', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "Claim" (
    "id" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "type" "ClaimType" NOT NULL DEFAULT 'EFFICACY',
    "status" "ClaimStatus" NOT NULL DEFAULT 'PROPOSED',
    "productName" TEXT,
    "formulaRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Claim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Assessment" (
    "id" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "evidenceTitle" TEXT,
    "evidenceText" TEXT NOT NULL,
    "justified" BOOLEAN NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "reasoning" TEXT NOT NULL,
    "needsReview" BOOLEAN NOT NULL,
    "checks" JSONB NOT NULL,
    "extracted" JSONB NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "latencyMs" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Assessment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Claim_status_idx" ON "Claim"("status");

-- CreateIndex
CREATE INDEX "Assessment_claimId_createdAt_idx" ON "Assessment"("claimId", "createdAt");

-- AddForeignKey
ALTER TABLE "Assessment" ADD CONSTRAINT "Assessment_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
