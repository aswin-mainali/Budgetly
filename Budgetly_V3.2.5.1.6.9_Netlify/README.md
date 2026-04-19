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
- Build command: `npm run build`
- Publish directory: `dist`

## Supabase setup
Run the SQL files in the `supabase/` folder as needed, starting with:
- `supabase/schema.sql`

Additional migrations are included for goals, recurring items, category emojis, and super admin setup.

## Notes
- `node_modules` and build output are intentionally excluded from the GitHub-ready package.
- This package is cleaned for pushing to GitHub.
