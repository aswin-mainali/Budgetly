import type { User } from '@supabase/supabase-js'
import { supabase } from './supabase'

export const USER_PROFILE_STORAGE_KEY = 'budgetly:userProfile'
const PROFILE_IMAGE_BUCKET = 'profile-images'

export type UserAccountProfile = {
  firstName: string
  lastName: string
  image: string
}

const normalizeProfile = (value?: Partial<UserAccountProfile> | null): UserAccountProfile => ({
  firstName: (value?.firstName || '').trim(),
  lastName: (value?.lastName || '').trim(),
  image: (value?.image || '').trim(),
})

export const readCachedUserProfile = (): UserAccountProfile => {
  if (typeof window === 'undefined') return normalizeProfile()
  try {
    const raw = window.localStorage.getItem(USER_PROFILE_STORAGE_KEY)
    if (!raw) return normalizeProfile()
    const parsed = JSON.parse(raw) as Partial<UserAccountProfile>
    return normalizeProfile(parsed)
  } catch {
    return normalizeProfile()
  }
}

const emitProfileUpdated = () => {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event('budgetly:profile-updated'))
}

export const cacheUserProfile = (profile: Partial<UserAccountProfile> | null) => {
  if (typeof window === 'undefined') return
  const normalized = normalizeProfile(profile)
  window.localStorage.setItem(USER_PROFILE_STORAGE_KEY, JSON.stringify(normalized))
  emitProfileUpdated()
}

export const clearCachedUserProfile = () => {
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(USER_PROFILE_STORAGE_KEY)
  emitProfileUpdated()
}

export const loadProfileFromTable = async (userId: string): Promise<UserAccountProfile> => {
  const result = await supabase
    .from('user_account_profiles')
    .select('first_name,last_name,image_url')
    .eq('user_id', userId)
    .maybeSingle()

  if (result.error) throw new Error(result.error.message || 'Failed to load account profile.')

  return normalizeProfile({
    firstName: result.data?.first_name ?? '',
    lastName: result.data?.last_name ?? '',
    image: result.data?.image_url ?? '',
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
    cacheUserProfile(normalizeProfile())
    return normalizeProfile()
  }
}

export const saveProfileToTable = async (userId: string, profile: UserAccountProfile) => {
  const payload = {
    user_id: userId,
    first_name: profile.firstName.trim(),
    last_name: profile.lastName.trim(),
    image_url: profile.image.trim() || null,
  }

  const { error } = await supabase.from('user_account_profiles').upsert(payload, { onConflict: 'user_id' })
  if (error) throw new Error(error.message || 'Failed to save account profile.')

  const normalized = normalizeProfile(profile)
  cacheUserProfile(normalized)
  return normalized
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

  if (uploadResult.error) throw new Error(uploadResult.error.message || 'Failed to upload profile image.')

  const { data: publicData } = supabase.storage.from(PROFILE_IMAGE_BUCKET).getPublicUrl(path)
  const imageUrl = publicData.publicUrl

  if (previousImageUrl.trim()) {
    void deleteProfileImage(previousImageUrl)
  }

  return imageUrl
}
