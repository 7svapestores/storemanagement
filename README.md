# 🚬 StoreWise — 7S Stores Management Platform

Production Next.js 14 + Supabase application for managing multiple 7S Vape & Smoke Shop stores. Deployed to Vercel at **7sstores.com**.

## Tech Stack
- **Frontend:** Next.js 14 (App Router) + Tailwind CSS
- **Database:** Supabase (PostgreSQL + Auth + Row Level Security)
- **Deployment:** Vercel (hosting + cron jobs)
- **Domain:** Namecheap → `7sstores.com`
- **Integrations:**
  - NRS POS API — daily sales sync + backfill
  - Anthropic Claude SDK — fallback parser for unknown invoice PDF layouts
  - Telegram bot — short/over alerts after NRS sync
  - Gmail SMTP — weekly email reports
  - Resend (optional) — NRS sync failure email alerts

## Quick Setup

### 1. Create Supabase Project
1. Go to [supabase.com](https://supabase.com) → New Project
2. Name it `storewise`, set a strong DB password, pick nearest region
3. Wait ~2 min for initialization

### 2. Set Up Database
1. Supabase Dashboard → **SQL Editor**
2. Paste the contents of `supabase/schema.sql` and **Run**
3. Run each file in `supabase/migrations/` in chronological order (see list below)

### 3. Get API Keys
In Supabase → **Settings → API**, copy:
- `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
- `anon public` → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `service_role secret` → `SUPABASE_SERVICE_ROLE_KEY`

### 4. Configure Locally
```bash
cp .env.local.example .env.local
```
Fill in the values (see **Environment Variables** below).

### 5. Install & Seed
```bash
npm install
node supabase/seed.mjs
```

### 6. Run Locally
```bash
npm run dev
```
Open http://localhost:3000

### 7. Deploy to Vercel
1. Push to GitHub: `git push`
2. [vercel.com](https://vercel.com) → Import → Select repo
3. Add all env vars from `.env.local`
4. Deploy

### 8. Connect Domain (Namecheap)
1. Vercel → Settings → Domains → Add `7sstores.com`
2. Namecheap → Domain → DNS → CNAME:
   - Host: `@` or `www`
   - Value: `cname.vercel-dns.com`

## Environment Variables

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...

# Email (Gmail SMTP for weekly reports)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
EMAIL_FROM=StoreWise <reports@yourdomain.com>

# App
NEXT_PUBLIC_APP_URL=http://localhost:3000
DEFAULT_TAX_RATE=0.0825

# NRS POS Integration
NRS_USER_TOKEN=your_nrs_token_here
NRS_API_BASE=https://pos-papi.nrsplus.com

# Cron Jobs
CRON_SECRET=generate-a-random-string

# Optional — Resend email alerts for NRS sync failures
RESEND_API_KEY=

# Telegram — short/over alerts after NRS sync
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=

# Anthropic — Claude fallback for unknown invoice PDF layouts
ANTHROPIC_API_KEY=
```

## Login Credentials (demo seed)

| Role | Email | Password |
|------|-------|----------|
| Owner | admin@storewise.app | admin123 |
| Employee 1–5 | emp1@storewise.app … emp5@storewise.app | emp123 |

⚠️ **Change passwords immediately after deployment!**

## Features

### Daily Operations
| Feature | Owner | Employee |
|---------|-------|----------|
| Dashboard (hero stats, live bar, action buttons, store bars) | ✅ | ❌ |
| Enter daily sales | ✅ | ✅ (own store only, no duplicates) |
| Edit/delete sales (with confirm + activity log) | ✅ | ❌ |
| Cash collection & reconciliation | ✅ | ❌ |
| Expenses (categories + custom + templates + date presets) | ✅ | ❌ |
| Purchases tracking | ✅ | ❌ |
| Inventory (stock, margins, alerts) | ✅ | ✅ (view only) |
| Vendor management | ✅ | ❌ |

### Reporting & Analysis
| Feature | Owner | Employee |
|---------|-------|----------|
| P&L report (side-by-side period comparisons, waterfall, trends) | ✅ | ❌ |
| Store comparison | ✅ | ❌ |
| Trends | ✅ | ❌ |
| CSV / Excel / PDF exports | ✅ | ❌ |
| Weekly email reports (Monday 7 AM cron) | ✅ | ❌ |

### Integrations
| Feature | Owner | Employee |
|---------|-------|----------|
| NRS POS sync + backfill + sync history | ✅ | ❌ |
| Warehouse prices (PDF invoice ingest, cross-vendor best-price compare) | ✅ | ❌ |
| Employee shift / shorts tracking | ✅ | ❌ |
| Telegram short/over alerts | ✅ | ❌ |

### Admin
| Feature | Owner | Employee |
|---------|-------|----------|
| Team management | ✅ | ❌ |
| Store settings | ✅ | ❌ |
| Activity log / audit trail | ✅ | ❌ |
| Cron setup UI | ✅ | ❌ |

## Warehouse Prices (Invoice Ingest)

Owners can upload vendor invoice PDFs and the system extracts line items for cross-vendor price comparison.

- **Supported vendors out of the box:** NEPA, Rave (custom parsers matched to `pdf-parse` output)
- **Unknown layouts:** Claude (via `@anthropic-ai/sdk`) extracts structured rows as a fallback
- **Storage:** PDFs are stored and deep-linked from the warehouse-prices UI
- **Aggregation:** All Products and Best Price views aggregate by `(product, vendor)` with min-price wins
- **Find Best Price:** ranks the top 3 vendors per product as 1st / 2nd / 3rd choice with price delta
- **Auto-refresh:** All Products table refreshes after each upload

Key files:
- `app/(app)/warehouse-prices/page.js` — UI
- `app/api/warehouse-prices/` — ingest + query routes
- `lib/invoice-parser.js` — NEPA + Rave + Claude fallback
- `supabase/migrations/add-warehouse-prices.sql` — schema

Note: `pdf-parse` is pinned to **1.1.1** — newer versions require `DOMMatrix` which isn't available in Node.

## Weekly Email Reports
Vercel Cron fires every Monday at 7 AM → `/api/cron/weekly-report`. Configure SMTP env vars for actual email delivery. Authorization requires the `CRON_SECRET` bearer token.

## Security
- **Supabase Auth** — login, sessions, password hashing
- **Row Level Security** — removed in favor of app-level auth checks (`lib/auth-check.js`) after RLS profile-fetch issues caused infinite loading; middleware + server code now gate every request
- **Auto-calculated fields** — tax, totals, short/over computed by DB triggers (tamper-proof)
- **Middleware auth** — `middleware.js` validates session server-side before rendering
- **Cron protection** — all cron routes require `CRON_SECRET` bearer token
- **Duplicate prevention** — employees cannot submit duplicate daily sales entries

## Project Structure

```
storemanagement/
├── app/
│   ├── (app)/                        # Authenticated pages (sidebar shell)
│   │   ├── activity/                 # Activity log / audit trail
│   │   ├── cash/                     # Cash collection & reconciliation
│   │   ├── compare/                  # Store comparison
│   │   ├── cron-setup/               # Cron config UI
│   │   ├── dashboard/                # Owner dashboard
│   │   ├── email/                    # Weekly email report preview
│   │   ├── employee-shorts/          # Short/over tracking
│   │   ├── employee-tracking/        # Shifts
│   │   ├── expenses/
│   │   ├── exports/                  # CSV / Excel / PDF
│   │   ├── inventory/
│   │   ├── invoices/                 # Invoice PDFs
│   │   ├── nrs-backfill/             # NRS historical sync
│   │   ├── nrs-sync-history/
│   │   ├── purchases/
│   │   ├── reports/                  # P&L (waterfall, period compare)
│   │   ├── sales/
│   │   ├── settings/
│   │   ├── team/
│   │   ├── trends/
│   │   ├── vendors/
│   │   ├── warehouse-prices/         # PDF ingest + best-price compare
│   │   ├── layout.js
│   │   └── error.js
│   ├── api/
│   │   ├── admin/
│   │   ├── auth/                     # Register + callback
│   │   ├── cron/                     # Weekly report, NRS sync
│   │   ├── nrs/                      # NRS POS integration
│   │   ├── profile/
│   │   ├── telegram/                 # Short/over alerts
│   │   └── warehouse-prices/         # Invoice ingest API
│   ├── auth/callback/route.js
│   ├── login/page.js
│   ├── globals.css
│   ├── layout.js
│   └── page.js
├── components/
│   ├── AppShell.js
│   ├── AuthProvider.js
│   ├── ImageGallery.js
│   ├── NRSSyncModal.js
│   ├── Sidebar.js                    # 230px, grouped sections, SVG icons
│   ├── ThemeToggle.js
│   ├── UI.js                         # Shared UI primitives
│   └── ui/
├── contexts/
│   └── ThemeContext.js               # Light/dark theme
├── lib/
│   ├── activity.js                   # Audit log writer
│   ├── auth-check.js                 # App-level auth (post-RLS)
│   ├── extract-shifts.js
│   ├── invoice-parser.js             # NEPA + Rave + Claude fallback
│   ├── nrs-client.js                 # NRS POS API client
│   ├── storage.js
│   ├── supabase-browser.js
│   ├── supabase-server.js
│   ├── telegram.js                   # Short/over alerts
│   └── utils.js
├── supabase/
│   ├── schema.sql                    # Base schema
│   ├── seed.mjs                      # Demo data
│   ├── seed-real.mjs
│   ├── add-vendors.mjs
│   ├── activity-log.sql
│   ├── disable-rls.sql
│   └── migrations/                   # See list below
├── middleware.js                     # Session validation
├── next.config.js
├── tailwind.config.js
├── postcss.config.js
├── jsconfig.json
├── vercel.json                       # Cron config
└── package.json
```

## Supabase Migrations

Run in chronological order after the base `schema.sql`:

1. `add-ai-review-fields.sql`
2. `add-basket-r2-diff.sql`
3. `add-cashapp-check.sql`
4. `add-house-account.sql`
5. `add-invoices.sql`
6. `invoices-cascade.sql`
7. `add-manual-gross-net.sql`
8. `add-receipt-arrays.sql`
9. `add-receipt-verification.sql`
10. `add-safe-drop-fields.sql`
11. `add-sales-fields.sql`
12. `employee-shortover.sql`
13. `employee_shifts.sql`
14. `fix-shortover-formula.sql`
15. `separate-shortover-diff.sql`
16. `nrs_integration.sql`
17. `add-telegram-chat-id.sql`
18. `update-total-sales-trigger.sql`
19. `add-non-tax-sales.sql`
20. `add-expense-date-column.sql`
21. `fix-total-sales-backfill.sql`
22. `trigger-r2-aware.sql`
23. `add-warehouse-prices.sql`

## Scripts

```bash
npm run dev        # next dev
npm run build      # next build
npm run start      # next start
npm run lint       # next lint
npm run db:seed    # node supabase/seed.mjs
```

## Recent Changes (chronological highlights)

**Warehouse Prices / Invoice Ingest**
- Warehouse prices feature with PDF invoice ingest + cross-vendor price search
- Pinned `pdf-parse` to v1.1.1 (newer versions require `DOMMatrix`)
- Rave parser matches `pdf-parse` actual column order; raw text shown when 0 items parsed
- NEPA parser matches glued-column layout
- Claude (Anthropic SDK) fallback for unknown invoice layouts
- Store invoice PDFs + deep-link from warehouse prices
- Replaced Recent Ingests with All Products + smart search
- Fall back to sibling invoice row when joined invoice has no PDF URL
- Auto-refresh All Products table after upload
- Aggregate All Products and Best Price by (product, vendor) with min-price wins
- Find Best Price rows labeled 1st/2nd/3rd choice with price delta

**Dashboard & Sidebar**
- Visual refresh: live bar, new hero, action buttons, store bars
- Sidebar restructured with grouped sections and SVG icons (230px width)
- Main content offset aligned with new sidebar width

**P&L Report**
- Store pills + full dollar amounts
- Hides Store Performance in single-store view, drops Top Items / By Category
- Flattened tabs + side-by-side period comparisons
- Expenses + product buying drill-downs compare current vs last period
- Dedup hero, moved margin next to net profit, added Cash in Hand
- Waterfall, sales trend, cash recon get side-by-side period cards
- Drill-downs reorder to match stat-card order + click-to-jump

**Cash in Hand**
- Panel shows expected + short/over sub-line
- Colored short/over sub-line for at-a-glance read
- Stat-card row stretches every panel to equal height

**Core & Quality**
- Daily-avg uses last sync date; dashboard alerts non-clickable
- Dashboard stats + weekly chart label placement fixes
- Reorganized menu, renamed purchases, employee inventory access
- Expense categories + custom expenses + templates + date presets
- Validations, mobile logout
- Owner edit/delete with confirm dialog and activity logging
- Prevent duplicate daily sales entries by employees
- Removed RLS, handle auth in app code (permanent fix for infinite loading)
- Activity log and audit trail
- Full mobile-first responsive
- Branding updated to 7S Stores

## Estimated Monthly Cost

| Service | Cost |
|---------|------|
| Supabase Free (testing) | $0 |
| Supabase Pro (production) | $25 |
| Vercel Hobby (personal) | $0 |
| Vercel Pro (commercial) | $20 |
| Namecheap `.com` domain | ~$1 |
| Anthropic API (Claude invoice fallback, pay per use) | ~$0–5 |
| **Total** | **$0–51/mo** |
