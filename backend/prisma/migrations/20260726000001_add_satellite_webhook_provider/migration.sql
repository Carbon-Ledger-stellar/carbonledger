CREATE TABLE "SatelliteWebhookProvider" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hmacKey" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SatelliteWebhookProvider_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SatelliteWebhookProvider_providerId_key" ON "SatelliteWebhookProvider"("providerId");
CREATE INDEX "SatelliteWebhookProvider_providerId_idx" ON "SatelliteWebhookProvider"("providerId");
CREATE INDEX "SatelliteWebhookProvider_isActive_idx" ON "SatelliteWebhookProvider"("isActive");
