# 🚬 StoreWise — Smoke Shop Management Platform

Production-ready Next.js + Supabase application for managing multiple smoke shop stores.

## Tech Stack
- **Frontend**: Next.js 14 (App Router) + Tailwind CSS
- **Database**: Supabase (PostgreSQL + Auth + Row Level Security)
- **Deployment**: Vercel
- **Domain**: Namecheap

## Quick Setup (15 minutes)

### Step 1: Create Supabase Project
1. Go to [supabase.com](https://supabase.com) → New Project
2. Name it `storewise`, choose a strong database password, select region closest to you
3. Wait for project to initialize (~2 min)

### Step 2: Set Up Database
1. In Supabase Dashboard → **SQL Editor**
2. Copy the entire contents of `supabase/schema.sql`
3. Paste and click **Run** — this creates all tables, indexes, RLS policies, and triggers

### Step 3: Get API Keys
1. Go to **Settings → API** in your Supabase Dashboard
2. Copy:
   - `Project URL` → this is your `NEXT_PUBLIC_SUPABASE_URL`
   - `anon public` key → this is your `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role secret` key → this is your `SUPABASE_SERVICE_ROLE_KEY`

### Step 4: Configure Locally
```bash
cp .env.local.example .env.local
```
Fill in your three Supabase keys in `.env.local`

### Step 5: Seed Demo Data
```bash
npm install
node supabase/seed.mjs
```

### Step 6: Run Locally
```bash
npm run dev
```
Open http://localhost:3000

### Step 7: Deploy to Vercel
1. Push to GitHub: `git init && git add . && git commit -m "init" && git push`
2. Go to [vercel.com](https://vercel.com) → Import → Select your repo
3. Add environment variables:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
4. Click Deploy

### Step 8: Connect Domain (Namecheap)
1. In Vercel → Settings → Domains → Add `storewise.com`
2. In Namecheap → Domain → DNS → Add CNAME record:
   - Host: `@` or `www`
   - Value: `cname.vercel-dns.com`

## Login Credentials

| Role | Email | Password |
|------|-------|----------|
| Owner | admin@storewise.app | admin123 |
| Employee 1 | emp1@storewise.app | emp123 |
| Employee 2 | emp2@storewise.app | emp123 |
| Employee 3 | emp3@storewise.app | emp123 |
| Employee 4 | emp4@storewise.app | emp123 |
| Employee 5 | emp5@storewise.app | emp123 |

⚠️ **Change passwords immediately after deployment!**

## Features

| Feature | Owner | Employee |
|---------|-------|----------|
| Dashboard (stats, trends, alerts) | ✅ | ❌ |
| Enter daily sales | ✅ | ✅ (own store only) |
| Edit/delete sales | ✅ | ❌ |
| Cash collection & reconciliation | ✅ | ❌ |
| Purchases tracking | ✅ | ❌ |
| Inventory (stock, margins, alerts) | ✅ | ❌ |
| Expenses | ✅ | ❌ |
| Vendor management | ✅ | ❌ |
| P&L reports | ✅ | ❌ |
| CSV export | ✅ | ❌ |
| Weekly email reports | ✅ | ❌ |
| Team management | ✅ | ❌ |
| Store settings | ✅ | ❌ |

## Security
- **Supabase Auth** — handles login, sessions, password hashing
- **Row Level Security** — database-level enforcement, employees physically cannot query other stores' data
- **Auto-calculated fields** — tax and totals computed by database triggers, can't be tampered with
- **Middleware auth** — every page checks session server-side before rendering

## Weekly Email Reports
Vercel Cron runs every Monday at 7 AM, hitting `/api/cron/weekly-report`. Configure SMTP in environment variables for actual email delivery.

## Estimated Monthly Cost
| Service | Cost |
|---------|------|
| Supabase Free (while testing) | $0 |
| Supabase Pro (production) | $25 |
| Vercel Hobby (personal) | $0 |
| Vercel Pro (commercial) | $20 |
| Namecheap .com domain | ~$1 |
| **Total** | **$0–46/mo** |

## File Structure
```
storewise/
├── app/
│   ├── (app)/                  # Authenticated pages (with sidebar)
│   │   ├── dashboard/page.js
│   │   ├── sales/page.js       # Employee & owner views
│   │   ├── cash/page.js
│   │   ├── purchases/page.js
│   │   ├── inventory/page.js
│   │   ├── expenses/page.js
│   │   ├── vendors/page.js
│   │   ├── reports/page.js
│   │   ├── trends/page.js
│   │   ├── exports/page.js
│   │   ├── email/page.js
│   │   ├── team/page.js
│   │   ├── settings/page.js
│   │   └── layout.js          # App shell with sidebar
│   ├── login/page.js
│   ├── auth/callback/route.js
│   ├── api/
│   │   ├── auth/register/route.js
│   │   └── cron/weekly-report/route.js
│   ├── globals.css
│   ├── layout.js
│   └── page.js
├── components/
│   ├── AuthProvider.js
│   ├── Sidebar.js
│   ├── AppShell.js
│   └── UI.js
├── lib/
│   ├── supabase-browser.js
│   ├── supabase-server.js
│   └── utils.js
├── supabase/
│   ├── schema.sql
│   └── seed.mjs
├── middleware.js
├── tailwind.config.js
├── vercel.json
└── package.json
```
