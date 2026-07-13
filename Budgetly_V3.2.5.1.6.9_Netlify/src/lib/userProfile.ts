import type { User } from '@supabase/supabase-js'
import { supabase } from './supabase'

const PROFILE_IMAGE_BUCKET = 'profile-images'

export type UserAccountProfile = {
  firstName: string
  lastName: string
  image: string
  walkthroughCompleted: boolean
}

let inMemoryProfile: UserAccountProfile = {
  firstName: '',
  lastName: '',
  image: '',
  walkthroughCompleted: false,
}

const normalizeProfile = (value?: Partial<UserAccountProfile> | null): UserAccountProfile => ({
  firstName: (value?.firstName || '').trim(),
  lastName: (value?.lastName || '').trim(),
  image: (value?.image || '').trim(),
  walkthroughCompleted: Boolean(value?.walkthroughCompleted),
})

const emitProfileUpdated = () => {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('budgetly:profile-updated', { detail: inMemoryProfile }))
}

export const readCachedUserProfile = (): UserAccountProfile => inMemoryProfile

export const cacheUserProfile = (profile: Partial<UserAccountProfile> | null) => {
  inMemoryProfile = normalizeProfile(profile)
  emitProfileUpdated()
}

export const clearCachedUserProfile = () => {
  inMemoryProfile = normalizeProfile()
  emitProfileUpdated()
}

export const loadProfileFromTable = async (userId: string): Promise<UserAccountProfile> => {
  const result = await supabase
    .from('user_account_profiles')
    .select('first_name,last_name,image_url,walkthrough_completed_at')
    .eq('user_id', userId)
    .maybeSingle()

  if (result.error) throw new Error(result.error.message || 'Failed to load account profile.')

  return normalizeProfile({
    firstName: result.data?.first_name ?? '',
    lastName: result.data?.last_name ?? '',
    image: result.data?.image_url ?? '',
    walkthroughCompleted: result.data?.walkthrough_completed_at != null,
  })
}

export const syncProfileCacheForUser = async (user: User | null) => {
  if (!user?.id) {
    clearCachedUserProfile()
    return normalizeProfile()
  }

  try {
    const profile = await loadProfileFromTable(user.id)
    cacheUserProfile(profile)
    return profile
  } catch {
    clearCachedUserProfile()
    return normalizeProfile()
  }
}

export const saveProfileToTable = async (
  userId: string,
  profile: Pick<UserAccountProfile, 'firstName' | 'lastName' | 'image'>,
) => {
  const payload = {
    user_id: userId,
    first_name: profile.firstName.trim(),
    last_name: profile.lastName.trim(),
    image_url: profile.image.trim() || null,
  }

  // Note: the walkthrough flag is intentionally omitted from the payload so
  // editing the profile never resets it (the column keeps its stored value).
  const { error } = await supabase.from('user_account_profiles').upsert(payload, { onConflict: 'user_id' })
  if (error) throw new Error(error.message || 'Failed to save account profile.')

  const normalized = normalizeProfile({ ...profile, walkthroughCompleted: inMemoryProfile.walkthroughCompleted })
  cacheUserProfile(normalized)
  return normalized
}

// Persist that the user has completed or dismissed the first sign-in walkthrough.
export const markWalkthroughCompleted = async (userId: string) => {
  const { error } = await supabase
    .from('user_account_profiles')
    .upsert({ user_id: userId, walkthrough_completed_at: new Date().toISOString() }, { onConflict: 'user_id' })
  if (error) throw new Error(error.message || 'Failed to save walkthrough state.')

  cacheUserProfile({ ...inMemoryProfile, walkthroughCompleted: true })
}

const fileExtension = (fileName: string) => {
  const parts = fileName.split('.')
  return (parts.length > 1 ? parts.pop() : 'jpg') || 'jpg'
}

const profileImagePathFromUrl = (imageUrl: string) => {
  const value = imageUrl.trim()
  if (!value) return ''
  const marker = `/${PROFILE_IMAGE_BUCKET}/`
  const markerIndex = value.indexOf(marker)
  if (markerIndex >= 0) return value.slice(markerIndex + marker.length)
  return value
}

export const deleteProfileImage = async (imageUrl: string) => {
  const path = profileImagePathFromUrl(imageUrl)
  if (!path) return
  await supabase.storage.from(PROFILE_IMAGE_BUCKET).remove([path])
}

export const uploadProfileImage = async (userId: string, file: File, previousImageUrl = '') => {
  const ext = fileExtension(file.name)
  const path = `${userId}/${Date.now()}-${crypto.randomUUID()}.${ext}`
  const uploadResult = await supabase.storage.from(PROFILE_IMAGE_BUCKET).upload(path, file, {
    upsert: false,
    cacheControl: '3600',
    contentType: file.type || undefined,
  })

  if (uploadResult.error) {
    const message = uploadResult.error.message || 'Failed to upload profile image.'
    if (message.toLowerCase().includes('bucket not found')) {
      throw new Error('Profile image bucket "profile-images" is missing. Run the user_account_profiles storage SQL migration in Supabase first.')
    }
    throw new Error(message)
  }

  const { data: publicData } = supabase.storage.from(PROFILE_IMAGE_BUCKET).getPublicUrl(path)
  const imageUrl = publicData.publicUrl

  if (previousImageUrl.trim()) {
    void deleteProfileImage(previousImageUrl)
  }

  return imageUrl
}
