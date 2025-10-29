# Database Reset Guide (Supabase Cloud)

This guide will help you reset your **Supabase Cloud** database to start fresh with the new schema structure.

## Why Reset?

Since we're pre-production, we're consolidating all migration history. This eliminates the old `aismr` table migrations and starts fresh with the `videos` table structure.

## Prerequisites

### 1. Get Your Database Connection String

From Supabase Dashboard:

- Go to: **Settings → Database → Connection String**
- Select **URI** format
- Copy the connection string

It looks like:

```
postgresql://postgres:[YOUR-PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres
```

### 2. Create a `.env` File

Create a `.env` file in the project root:

```bash
DATABASE_URL='postgresql://postgres:[YOUR-PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres'
```

⚠️ **Replace `[YOUR-PASSWORD]` with your actual database password**

### 3. Install PostgreSQL Client

```bash
# macOS
brew install postgresql

# Linux
sudo apt-get install postgresql-client
```

## Reset Methods

### Option 1: Using the Reset Script ⭐ (Recommended)

```bash
./scripts/reset-database.sh
```

### Option 2: Using npm Script

```bash
npm run dev-reset
npm run db:operations:migrate
```

### Option 3: Manual via Supabase Dashboard

1. Go to **SQL Editor** in Supabase
2. Copy contents from `sql/dev-reset.sql`
3. Paste and **Run**

### Option 4: Direct psql

```bash
export $(grep -v '^#' .env | grep DATABASE_URL | xargs)
psql "$DATABASE_URL" -f sql/dev-reset.sql
```

## What Changed?

- **Old**: `aismr` table (project-specific, globally unique ideas)
- **New**: `videos` table (multi-project, ideas unique per project)

## Verify

Check in **Supabase Dashboard → Table Editor**:

- ✅ `projects`, `personas`, `prompts`, `runs`, `videos`, `workflow_logs`

## Next Steps

1. Reset the database
2. Run `npm run db:operations:migrate` to seed the `runs` and `videos` tables
3. Verify tables in Supabase
4. Test workflows
