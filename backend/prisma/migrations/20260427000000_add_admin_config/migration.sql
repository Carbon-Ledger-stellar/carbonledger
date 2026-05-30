-- CreateTable
CREATE TABLE "AdminConfig" (
    "key"       TEXT NOT NULL,
    "value"     TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminConfig_pkey" PRIMARY KEY ("key")
);
