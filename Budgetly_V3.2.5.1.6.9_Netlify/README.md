# Budgetly

Budgetly is a Vite + React + Supabase budgeting app.

## Tech stack
- React
- TypeScript
- Vite
- Supabase
- Recharts
- Netlify-ready config

## Getting started
1. Install dependencies:
   ```bash
   npm install
   ```
2. Create a `.env` file in the project root:
   ```env
   VITE_SUPABASE_URL=your_supabase_project_url
   VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
   ```
   Or copy from `.env.example`.
3. Start the app:
   ```bash
   npm run dev
   ```

## Build
```bash
npm run build
```

## Preview production build
```bash
npm run preview
```

## Deploy to Netlify
- Import the repo into Netlify.
- Add these environment variables in Netlify:
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_ANON_KEY`
  - `ANTHROPIC_API_KEY` — required for AI Receipt Capture and the Document Vault's AI extraction (the `receipt-scan` and `document-extract` Netlify functions call the Claude API server-side). Optional: `RECEIPT_SCAN_MODEL` / `DOCUMENT_EXTRACT_MODEL` to override the models (both default to `claude-opus-4-8`).
- Build command: `npm run build`
- Publish directory: `dist`

## AI Receipt Capture
On the Transactions page, **Scan Receipt** opens the camera (or lets you upload a photo), sends the image to the `receipt-scan` serverless function which calls the Claude vision API, and pre-fills the Add Transaction form with the merchant, amount, date, and best-matching category. The captured receipt is stored with the transaction and can be re-opened later from the row's actions menu (**View receipt**). Requires `ANTHROPIC_API_KEY` to be set.

## Document Vault
Utilities → **Document Vault** is a PIN-protected store for important documents (agreements, insurance policies, contracts, warranties, leases…). Uploads go to a **private** Supabase storage bucket and are opened through short-lived signed URLs. When you add a PDF or image, the `document-extract` Netlify function reads it with the Claude API and auto-fills the title, type, issuer, reference number, and — most importantly — the **agreement and expiration dates**. Budgetly then raises escalating in-app notifications (30/14/7/3/1 days out, on the day, and once expired).

- **PIN gate** — the vault asks for a PIN every time you open it (and re-locks when the tab is hidden). The PIN is hashed on the device (SHA-256 + per-user salt) and only the hash is stored, so it works across devices without exposing the PIN.
- **Forgot PIN** — emails a one-time code (via Resend) that the `document-vault-pin-reset` edge function verifies before setting a new PIN.

Setup:
```bash
# 1. Tables, private bucket + RLS, and the notification toggle column
#    (run supabase/add_document_vault.sql in the SQL editor or `supabase db push`)
# 2. Forgot-PIN email (reuses the same RESEND_API_KEY / DIGEST_FROM as bug emails)
supabase functions deploy document-vault-pin-reset
```
`ANTHROPIC_API_KEY` (already needed for Receipt Capture) powers the AI extraction.

## Supabase setup
Run the SQL files in the `supabase/` folder as needed, starting with:
- `supabase/schema.sql`

Additional migrations are included for goals, recurring items, category emojis, receipt capture (`add_receipt_capture.sql`), the Document Vault (`add_document_vault.sql`), super admin setup, and full data backup & restore (`add_backup_restore.sql`).

## Data backup & restore
Settings → **Data & backup** provides a complete, restorable backup system (replacing the old CSV/JSON export):
- **Full backup** — the `data-backup` edge function gathers every user-owned record across all domains, builds one JSON file per domain plus a `manifest.json` (version, timestamp, per-domain counts, SHA-256 checksum) and a `README.txt`, and returns it as a downloadable `.zip`. Optional client-side **AES-256 password protection** (zip.js) encrypts the archive before download. Rate-limited per user.
- **Automatic backups** — an optional weekly `auto-backup` cron function stores backups in the private `user-backups` storage bucket and keeps the last 8.
- **Restore** — upload a backup `.zip`; the `data-restore` edge function validates the manifest + checksum + version and referential integrity, shows an add/remove diff, and (after taking a safety snapshot) applies a **Merge** or **Replace** restore transactionally via the `restore_user_backup` RPC.

Deploy the three edge functions and enable the weekly cron as documented in `supabase/add_backup_restore.sql`:
```bash
supabase functions deploy data-backup
supabase functions deploy data-restore
supabase functions deploy auto-backup --no-verify-jwt
```

## Notes
- `node_modules` and build output are intentionally excluded from the GitHub-ready package.
- This package is cleaned for pushing to GitHub.


### Logo configuration for Investments
Set `VITE_LOGO_DEV_TOKEN=your_logo_dev_token` in Netlify for automatic domain-based logos. Without it, Budgetly uses static symbol logo fallbacks and initials.
