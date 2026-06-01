# Database Migration Instructions

## Adding Certificate Fields to RetirementRecord

### Automatic Migration (Recommended)

Run this command from the `backend` directory:

```bash
npx prisma migrate dev --name add_certificate_fields
```

This will:
1. Create a new migration file in `prisma/migrations/`
2. Apply the migration to your database
3. Regenerate the Prisma client

### What Gets Added

The migration adds these fields to the `RetirementRecord` table:

```sql
ALTER TABLE "RetirementRecord" ADD COLUMN "certificateStatus" TEXT NOT NULL DEFAULT 'pending_certificate';
ALTER TABLE "RetirementRecord" ADD COLUMN "certificateCid" TEXT;
ALTER TABLE "RetirementRecord" ADD COLUMN "certificateUrl" TEXT;
ALTER TABLE "RetirementRecord" ADD COLUMN "certificateRetries" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "RetirementRecord" ADD COLUMN "certificateFailedAt" TIMESTAMP;
ALTER TABLE "RetirementRecord" ADD COLUMN "certificateGeneratedAt" TIMESTAMP;
```

### Manual Migration (If Needed)

If you need to apply the migration manually:

1. Connect to your PostgreSQL database:
   ```bash
   psql postgresql://carbonledger:changeme@localhost:5432/carbonledger
   ```

2. Run the SQL commands above

3. Update Prisma schema:
   ```bash
   npx prisma db pull
   ```

### Verify Migration

Check that the migration was applied:

```bash
# Check migration status
npx prisma migrate status

# View the database schema
npx prisma studio

# Query the table
psql -c "SELECT column_name, data_type FROM information_schema.columns WHERE table_name='RetirementRecord';"
```

### Rollback (If Needed)

To rollback the migration:

```bash
# Resolve the migration as rolled back
npx prisma migrate resolve --rolled-back add_certificate_fields

# Or manually drop the columns
psql -c "ALTER TABLE \"RetirementRecord\" DROP COLUMN certificateStatus, DROP COLUMN certificateCid, DROP COLUMN certificateUrl, DROP COLUMN certificateRetries, DROP COLUMN certificateFailedAt, DROP COLUMN certificateGeneratedAt;"
```

### Troubleshooting

**Migration fails with "column already exists"**
- The columns may already exist from a previous migration
- Check the database schema: `npx prisma studio`
- If columns exist, you can safely ignore the error

**Migration fails with "permission denied"**
- Ensure your database user has ALTER TABLE permissions
- Check DATABASE_URL in .env

**Prisma client out of sync**
- Regenerate the client: `npx prisma generate`
- Restart your application

### Next Steps

After migration:

1. Verify the schema: `npx prisma studio`
2. Start the backend: `npm run start:dev`
3. Check logs for "Polling for pending certificates..."
4. Test with a retirement: `POST /credits/retire`
5. Check certificate status: `GET /retirements/certificate-status/:id`

### Schema Changes

The `RetirementRecord` model now includes:

```prisma
model RetirementRecord {
  // ... existing fields ...
  
  // Certificate fields
  certificateStatus     String   @default("pending_certificate")
  certificateCid        String?
  certificateUrl        String?
  certificateRetries    Int      @default(0)
  certificateFailedAt   DateTime?
  certificateGeneratedAt DateTime?
}
```

### Certificate Status Values

- `pending_certificate` - Waiting to be processed
- `generating` - Currently generating PDF and uploading to IPFS
- `completed` - Successfully generated and stored
- `failed` - Failed after 3 retry attempts

### Database Indexes

Consider adding indexes for better query performance:

```sql
CREATE INDEX idx_retirement_certificate_status ON "RetirementRecord"(certificateStatus);
CREATE INDEX idx_retirement_certificate_generated ON "RetirementRecord"(certificateGeneratedAt);
```

### Backup Recommendation

Before running the migration, backup your database:

```bash
# PostgreSQL backup
pg_dump postgresql://carbonledger:changeme@localhost:5432/carbonledger > backup.sql

# Restore if needed
psql postgresql://carbonledger:changeme@localhost:5432/carbonledger < backup.sql
```

### Production Deployment

For production:

1. Backup database
2. Test migration on staging environment
3. Schedule migration during low-traffic period
4. Run migration: `npx prisma migrate deploy`
5. Verify schema: `npx prisma studio`
6. Monitor logs for errors
7. Restart application

### Support

If you encounter issues:

1. Check Prisma documentation: https://www.prisma.io/docs/concepts/components/prisma-migrate
2. Review migration file: `prisma/migrations/*/migration.sql`
3. Check database logs: `psql -l`
4. Verify DATABASE_URL: `echo $DATABASE_URL`
