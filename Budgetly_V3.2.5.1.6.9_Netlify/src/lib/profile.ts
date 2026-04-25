import { supabase } from './supabase'

export type UserProfileRecord = {
  id: string
  email: string
  first_name: string
  last_name: string
  avatar_url: string | null
}

const AVATAR_BUCKET = 'avatars'

const normalizeName = (value: string) => value.trim()

export const getAvatarPublicUrl = (avatarPath: string | null | undefined) => {
  if (!avatarPath) return ''
  const { data } = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(avatarPath)
  return data.publicUrl || ''
}

export const uploadProfileAvatar = async (file: File, userId: string) => {
  const ext = (file.name.split('.').pop() || 'png').toLowerCase()
  const path = `${userId}/avatar.${ext}`
  const uploadResult = await supabase.storage
    .from(AVATAR_BUCKET)
    .upload(path, file, { upsert: true, contentType: file.type || undefined })
  if (uploadResult.error) throw new Error(uploadResult.error.message || 'Failed to upload avatar.')
  return path
}

export const deleteProfileAvatar = async (avatarPath: string | null | undefined) => {
  if (!avatarPath) return
  const result = await supabase.storage.from(AVATAR_BUCKET).remove([avatarPath])
  if (result.error) throw new Error(result.error.message || 'Failed to remove avatar.')
}

export const getUserProfile = async (userId: string) => {
  const result = await supabase
    .from('profiles')
    .select('id,email,first_name,last_name,avatar_url')
    .eq('id', userId)
    .maybeSingle()
  if (result.error && result.error.code !== 'PGRST116') throw new Error(result.error.message || 'Failed to load profile.')
  if (!result.data) return null
  return {
    id: result.data.id,
    email: result.data.email ?? '',
    first_name: result.data.first_name ?? '',
    last_name: result.data.last_name ?? '',
    avatar_url: result.data.avatar_url ?? null,
  } as UserProfileRecord
}

export const saveUserProfile = async (input: {
  userId: string
  email: string | null
  firstName: string
  lastName: string
  avatarPath: string | null
}) => {
  const payload = {
    id: input.userId,
    email: input.email ?? '',
    first_name: normalizeName(input.firstName),
    last_name: normalizeName(input.lastName),
    avatar_url: input.avatarPath,
  }
  const result = await supabase.from('profiles').upsert(payload, { onConflict: 'id' }).select('id,email,first_name,last_name,avatar_url').maybeSingle()
  if (result.error) throw new Error(result.error.message || 'Failed to save profile.')
  const row = result.data
  if (!row) throw new Error('Profile save returned empty data.')
  return {
    id: row.id,
    email: row.email ?? '',
    first_name: row.first_name ?? '',
    last_name: row.last_name ?? '',
    avatar_url: row.avatar_url ?? null,
  } as UserProfileRecord
}
