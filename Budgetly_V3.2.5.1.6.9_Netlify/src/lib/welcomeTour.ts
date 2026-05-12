import { supabase } from './supabase'

export type WelcomeTourState = {
  hasSeen: boolean
  completed: boolean
}

export const loadWelcomeTourState = async (userId: string): Promise<WelcomeTourState> => {
  const { data, error } = await supabase
    .from('user_onboarding')
    .select('has_seen_welcome_tour,welcome_tour_completed')
    .eq('user_id', userId)
    .maybeSingle()

  if (error) throw new Error(error.message || 'Failed to load welcome tour state')

  return {
    hasSeen: !!data?.has_seen_welcome_tour,
    completed: !!data?.welcome_tour_completed,
  }
}

export const saveWelcomeTourState = async (userId: string, patch: Partial<{ has_seen_welcome_tour: boolean; welcome_tour_completed: boolean }>) => {
  const payload = {
    user_id: userId,
    has_seen_welcome_tour: patch.has_seen_welcome_tour ?? true,
    welcome_tour_completed: patch.welcome_tour_completed ?? false,
  }
  const { error } = await supabase.from('user_onboarding').upsert(payload, { onConflict: 'user_id' })
  if (error) throw new Error(error.message || 'Failed to save welcome tour state')
}
