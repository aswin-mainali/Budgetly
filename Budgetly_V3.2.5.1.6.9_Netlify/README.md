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
  - `ANTHROPIC_API_KEY` — required for AI Receipt Capture (the `receipt-scan` Netlify function calls the Claude API server-side). Optional: `RECEIPT_SCAN_MODEL` to override the vision model (defaults to `claude-opus-4-8`).
- Build command: `npm run build`
- Publish directory: `dist`

## AI Receipt Capture
On the Transactions page, **Scan Receipt** opens the camera (or lets you upload a photo), sends the image to the `receipt-scan` serverless function which calls the Claude vision API, and pre-fills the Add Transaction form with the merchant, amount, date, and best-matching category. The captured receipt is stored with the transaction and can be re-opened later from the row's actions menu (**View receipt**). Requires `ANTHROPIC_API_KEY` to be set.

## Supabase setup
Run the SQL files in the `supabase/` folder as needed, starting with:
- `supabase/schema.sql`

Additional migrations are included for goals, recurring items, category emojis, receipt capture (`add_receipt_capture.sql`), and super admin setup.

## Notes
- `node_modules` and build output are intentionally excluded from the GitHub-ready package.
- This package is cleaned for pushing to GitHub.


### Logo configuration for Investments
Set `VITE_LOGO_DEV_TOKEN=your_logo_dev_token` in Netlify for automatic domain-based logos. Without it, Budgetly uses static symbol logo fallbacks and initials.
