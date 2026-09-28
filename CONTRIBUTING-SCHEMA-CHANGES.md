# Contributing Schema Changes

This document describes how to propose and land database schema changes in this repository.

## Overview

Schema changes include new tables, columns, indexes, constraints, and **database views**. All schema changes must be reviewed by a maintainer and shipped with a migration.

## Adding Database Views

Database views are used for reporting and analytics. When adding a view:

1. Create a migration that defines the view with `CREATE VIEW` (or `CREATE OR REPLACE VIEW`).
2. Give the view a stable, descriptive name (e.g. `pause_stats_daily`).
3. Keep column names stable and explicit — reporting queries depend on them.
4. Document the view's purpose and columns in the migration or a companion doc.
5. Add a rollback (`DROP VIEW`) in the migration's `down` step.

### Example: Pause Analytics Views

Pause analytics views aggregate pause duration, frequency, and reasons for reporting.

#### 1. Pause statistics by day/week/month

```sql
CREATE VIEW pause_stats_daily AS
SELECT
    DATE(paused_at) AS period,
    COUNT(*) AS pause_count,
    SUM(duration_seconds) AS total_duration_seconds,
    AVG(duration_seconds) AS avg_duration_seconds
FROM pauses
GROUP BY DATE(paused_at);
```

Weekly and monthly variants follow the same shape, using `DATE_TRUNC('week', paused_at)` and `DATE_TRUNC('month', paused_at)` respectively, with the same column names so reporting can switch granularity without changing queries.

#### 2. Pause reason breakdown

```sql
CREATE VIEW pause_reason_breakdown AS
SELECT
    reason,
    COUNT(*) AS pause_count,
    SUM(duration_seconds) AS total_duration_seconds,
    AVG(duration_seconds) AS avg_duration_seconds
FROM pauses
GROUP BY reason;
```

#### 3. Admin pause activity

```sql
CREATE VIEW admin_pause_activity AS
SELECT
    admin_id,
    DATE(paused_at) AS period,
    COUNT(*) AS pause_count,
    SUM(duration_seconds) AS total_duration_seconds
FROM pauses
WHERE admin_id IS NOT NULL
GROUP BY admin_id, DATE(paused_at);
```

### Reporting Usage

All views expose stable column names (`period`, `pause_count`, `total_duration_seconds`, `avg_duration_seconds`, `reason`, `admin_id`) so they can be queried directly from reporting tools and dashboards.

## Review Checklist

- [ ] Migration includes both `up` and `down`.
- [ ] View names and column names are stable and documented.
- [ ] Views are read-only and do not duplicate business logic already in application code.
- [ ] Reporting queries are covered by at least one test or example.
