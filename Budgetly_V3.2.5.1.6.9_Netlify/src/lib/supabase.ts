import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const SUPABASE_CONFIG_ERROR = !url || !anon
  ? 'Supabase is not configured. Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY.'
  : ''

if (!url || !anon) {
  // Throwing here makes misconfiguration obvious (and prevents silent "works locally but not deployed").
  // eslint-disable-next-line no-console
  console.error(`${SUPABASE_CONFIG_ERROR} Set these env vars in your deploy provider (for Netlify: Site configuration → Environment variables).`)
}

export const supabase = createClient(url ?? '', anon ?? '', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
})
