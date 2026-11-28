const credentialKey = (userId: string) => 'coffeeman:served-removal:' + userId

export function hasRemovalCredential(userId: string) {
  try { return Boolean(localStorage.getItem(credentialKey(userId))) }
  catch { return false }
}

function requestValue() {
  return crypto.getRandomValues(new Uint8Array(32))
}

function requireDeviceVerification() {
  if (!window.isSecureContext || typeof PublicKeyCredential === 'undefined' || !navigator.credentials) {
    throw new Error('Этот браузер не поддерживает подтверждение на устройстве')
  }
}

export async function configureServedRemoval(userId: string, name: string, enabled: boolean) {
  if (!enabled) {
    localStorage.removeItem(credentialKey(userId))
    return
  }
  requireDeviceVerification()
  const credential = await navigator.credentials.create({ publicKey: {
    rp: { name: 'COFFEEMAN' },
    user: { id: requestValue(), name, displayName: name },
    challenge: requestValue(),
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
    authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
    attestation: 'none',
    timeout: 60_000,
  } })
  if (!(credential instanceof PublicKeyCredential) || credential.authenticatorAttachment === 'cross-platform') {
    throw new Error('Настройте биометрию или код разблокировки на этом устройстве')
  }
  localStorage.setItem(credentialKey(userId), credential.id)
}

export async function confirmServedRemoval(userId: string) {
  requireDeviceVerification()
  const id = localStorage.getItem(credentialKey(userId))
  if (!id) throw new Error('Включите удаление выданных позиций в настройках')
  const rawId = Uint8Array.from(atob(id.replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0))
  let credential: Credential | null
  try {
    credential = await navigator.credentials.get({ publicKey: {
      challenge: requestValue(),
      allowCredentials: [{ id: rawId, type: 'public-key', transports: ['internal'] }],
      userVerification: 'required',
      timeout: 60_000,
    } })
  } catch {
    throw new Error('Подтверждение на устройстве не выполнено')
  }
  if (!(credential instanceof PublicKeyCredential) || credential.id !== id || credential.authenticatorAttachment === 'cross-platform' ||
      !(credential.response instanceof AuthenticatorAssertionResponse) ||
      !(new Uint8Array(credential.response.authenticatorData)[32] & 0x04)) {
    throw new Error('Подтверждение на устройстве не выполнено')
  }
}
