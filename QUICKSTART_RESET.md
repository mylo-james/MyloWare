# Quick Start: Reset Supabase Cloud Database

## Step 1: Get Your Connection String

1. Go to your Supabase Dashboard
2. **Settings** → **Database** → **Connection String**
3. Select **URI** tab
4. Copy the connection string (it looks like `postgresql://postgres:[PASSWORD]@db.xxx.supabase.co:5432/postgres`)

## Step 2: Create .env File

Create a `.env` file in the project root:

```bash
DATABASE_URL='postgresql://postgres:[YOUR-PASSWORD]@db.[YOUR-PROJECT-REF].supabase.co:5432/postgres'
```

Replace `[YOUR-PASSWORD]` with your actual database password from step 1.

## Step 3: Run the Reset

```bash
./scripts/reset-database.sh
```

Type `yes` when prompted.

## Done!

Your database now has:

- ✅ Clean schema with `videos` table (replaces `aismr`)
- ✅ Projects, personas, and prompts configured
- ✅ Ready for workflows

## Alternative: Manual Reset via Dashboard

If the script doesn't work:

1. Open Supabase Dashboard → **SQL Editor**
2. Copy all contents from `sql/dev-reset.sql`
3. Paste into SQL Editor
4. Click **Run**

---

**Need help?** See full guide in `docs/DATABASE_RESET.md`
