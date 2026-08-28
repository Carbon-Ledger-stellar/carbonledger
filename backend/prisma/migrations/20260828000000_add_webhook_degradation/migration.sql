-- Track consecutive outbound webhook failures without disabling subscriptions.
ALTER TABLE "WebhookSubscription"
  ADD COLUMN IF NOT EXISTS "degraded" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "consecutiveFailures" INTEGER NOT NULL DEFAULT 0;
