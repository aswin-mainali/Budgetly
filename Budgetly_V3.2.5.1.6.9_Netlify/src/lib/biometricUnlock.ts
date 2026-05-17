import { supabase } from './supabase'

const ENABLED_KEY_PREFIX = 'budgetly_biometric_unlock_enabled:'

type StoredPasskey = {
  id: string
  credential_id: string
}

const toBase64Url = (input: ArrayBuffer) => {
  const bytes = new Uint8Array(input)
  let str = ''
  bytes.forEach((byte) => { str += String.fromCharCode(byte) })
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

const fromBase64Url = (input: string) => {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(input.length / 4) * 4, '=')
  const str = atob(padded)
  return Uint8Array.from(str, (char) => char.charCodeAt(0))
}

const randomChallenge = (size = 32) => {
  const challenge = new Uint8Array(size)
  crypto.getRandomValues(challenge)
  return challenge
}

export const biometricSupported = () => typeof window !== 'undefined' && !!window.PublicKeyCredential && !!navigator.credentials
export const biometricStorageKey = (userId: string) => `${ENABLED_KEY_PREFIX}${userId}`
export const isBiometricEnabledForUser = (userId: string) => localStorage.getItem(biometricStorageKey(userId)) === 'true'

export const setBiometricEnabledForUser = (userId: string, enabled: boolean) => {
  localStorage.setItem(biometricStorageKey(userId), enabled ? 'true' : 'false')
}

export const registerBiometricCredential = async (user: { id: string; email?: string | null }) => {
  if (!biometricSupported()) throw new Error('Biometric unlock is not supported on this device/browser.')
  const challenge = randomChallenge()
  const userBytes = new TextEncoder().encode(user.id)

  const credential = await navigator.credentials.create({
    publicKey: {
      challenge,
      rp: { name: 'Budgetly', id: window.location.hostname },
      user: {
        id: userBytes,
        name: user.email ?? `budgetly-${user.id}`,
        displayName: user.email ?? 'Budgetly User',
      },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },
        { type: 'public-key', alg: -257 },
      ],
      authenticatorSelection: { userVerification: 'preferred', residentKey: 'preferred' },
      timeout: 60000,
      attestation: 'none',
    },
  }) as PublicKeyCredential | null

  if (!credential) throw new Error('Credential registration failed.')
  const response = credential.response as AuthenticatorAttestationResponse
  const credentialId = toBase64Url(credential.rawId)

  // TODO(security): replace this client-side metadata storage flow with server-side challenge generation + attestation verification.
  const { error } = await supabase.from('user_passkeys').insert({
    user_id: user.id,
    credential_id: credentialId,
    public_key: toBase64Url(response.getPublicKey() ?? new ArrayBuffer(0)),
    counter: 0,
    device_name: navigator.userAgent.slice(0, 120),
  })

  if (error) throw new Error(error.message)
  return credentialId
}

export const authenticateBiometricCredential = async (userId: string) => {
  if (!biometricSupported()) throw new Error('Biometric unlock is not supported on this device/browser.')

  const { data, error } = await supabase.from('user_passkeys').select('id, credential_id').eq('user_id', userId)
  if (error) throw new Error(error.message)
  const passkeys = (data ?? []) as StoredPasskey[]
  if (!passkeys.length) throw new Error('No passkey found for this device. Please sign in again.')

  const allowCredentials = passkeys
    .filter((item) => !!item.credential_id)
    .map((item) => ({ type: 'public-key' as const, id: fromBase64Url(item.credential_id) }))

  const credential = await navigator.credentials.get({
    publicKey: {
      challenge: randomChallenge(),
      userVerification: 'preferred',
      allowCredentials,
      timeout: 60000,
      rpId: window.location.hostname,
    },
  }) as PublicKeyCredential | null

  if (!credential) throw new Error('Unlock cancelled.')

  // TODO(security): production passkey auth must verify assertion server-side and update signature counters.
  const matched = passkeys.find((item) => item.credential_id === toBase64Url(credential.rawId))
  if (!matched) throw new Error('Biometric unlock failed. Try again or use password.')

  await supabase.from('user_passkeys').update({ last_used_at: new Date().toISOString() }).eq('id', matched.id).eq('user_id', userId)
  return true
}

export const removeBiometricCredential = async (userId: string) => {
  const { error } = await supabase.from('user_passkeys').delete().eq('user_id', userId)
  if (error) throw new Error(error.message)
}

export const PASSKEY_LOGIN_ENABLED_KEY = 'budgetly_passkey_login_enabled'
export const PASSKEY_LOGIN_USER_ID_KEY = 'budgetly_passkey_user_id'
export const PASSKEY_LOGIN_USER_EMAIL_KEY = 'budgetly_passkey_user_email'

export const setPasskeyLoginMarker = (userId: string, email?: string | null) => {
  localStorage.setItem(PASSKEY_LOGIN_ENABLED_KEY, 'true')
  localStorage.setItem(PASSKEY_LOGIN_USER_ID_KEY, userId)
  localStorage.setItem(PASSKEY_LOGIN_USER_EMAIL_KEY, email ?? '')
}

export const clearPasskeyLoginMarker = () => {
  localStorage.removeItem(PASSKEY_LOGIN_ENABLED_KEY)
  localStorage.removeItem(PASSKEY_LOGIN_USER_ID_KEY)
  localStorage.removeItem(PASSKEY_LOGIN_USER_EMAIL_KEY)
}
