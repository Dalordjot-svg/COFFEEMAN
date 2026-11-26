import { initializeApp } from 'firebase-admin/app'
import { getDatabaseWithUrl, ServerValue } from 'firebase-admin/database'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { logger } from 'firebase-functions'
import { applyCommand, DomainError, normalizeState } from '../../src/domain'
import type { Command, Session, State } from '../../src/domain'

initializeApp()

const namespace = 'coffeeman'
const safeId = /^[A-Za-z0-9_-]{1,128}$/
const safeEntityId = /^[A-Za-z0-9_-]{1,64}$/
const unsafeKeys = new Set(['__proto__', 'prototype', 'constructor'])
const timestampKeys = new Set([
  'createdAt', 'updatedAt', 'lastSeenAt', 'sentAt', 'readyAt', 'servedAt',
  'issuedAt', 'canceledAt', 'completedAt', 'requestedAt', 'reservedAt',
  'releasedAt', 'precheckAt', 'closedAt', 'resolvedAt', 'timestamp', 'at',
])

function safeTree(value: unknown, depth = 0, field = ''): boolean {
  if (depth > 12) return false
  if (value === null || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value === 'string') {
    if (field === 'userId' || field === 'waiterId') return safeId.test(value)
    if (field === 'id' || field.endsWith('Id') || field.endsWith('Ids')) return safeEntityId.test(value)
    return value.length <= 3000
  }
  if (Array.isArray(value)) return value.length <= 150 && value.every((entry) => safeTree(entry, depth + 1, field))
  if (typeof value !== 'object') return false
  const entries = Object.entries(value)
  return entries.length <= 150 && entries.every(([key, entry]) =>
    safeId.test(key) && !unsafeKeys.has(key) && safeTree(entry, depth + 1, key))
}

function withServerTimestamps(value: unknown, previous: unknown, now: number): unknown {
  if (Array.isArray(value)) {
    return value.map((entry, index) => withServerTimestamps(entry, Array.isArray(previous) ? previous[index] : undefined, now))
  }
  if (!value || typeof value !== 'object') return value
  const old = previous && typeof previous === 'object' ? previous as Record<string, unknown> : {}
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined).map(([key, entry]) => {
    const field = entry === now && entry !== old[key] && timestampKeys.has(key) ?
      ServerValue.TIMESTAMP : withServerTimestamps(entry, old[key], now)
    return [key, field]
  }))
}

export const coffeemanCommand = onCall({ region: 'us-central1', timeoutSeconds: 25 }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Сначала войдите в систему')
  const { uid, token } = request.auth
  const role = token.coffeemanRole
  if ((role !== 'waiter' && role !== 'admin') || !safeId.test(uid) || uid in Object.prototype) {
    throw new HttpsError('permission-denied', 'Для аккаунта не назначен доступ к COFFEEMAN')
  }
  const { deviceId, operationId, command } = request.data ?? {}
  const menuImport = command?.type === 'importMenu'
  if (menuImport && role !== 'admin') throw new HttpsError('permission-denied', 'Импорт меню доступен администратору')
  // The import parser validates the inner JSON and its fields inside the authorized transaction.
  const validPayload = menuImport
    ? request.rawRequest.rawBody.length <= 250000 && Object.keys(command).length === 2 &&
      Object.hasOwn(command, 'json') && typeof command.json === 'string'
    : request.rawRequest.rawBody.length <= 17000 && safeTree(command)
  if (typeof deviceId !== 'string' || !safeId.test(deviceId) || unsafeKeys.has(deviceId) ||
      typeof operationId !== 'string' || !safeEntityId.test(operationId) || operationId in Object.prototype ||
      !command || Array.isArray(command) || typeof command.type !== 'string' ||
      !validPayload) {
    throw new HttpsError('invalid-argument', 'Некорректные данные операции')
  }

  const databaseURL = process.env.COFFEEMAN_DATABASE_URL
  if (!databaseURL) throw new HttpsError('failed-precondition', 'Для COFFEEMAN не задан адрес Realtime Database')
  if (process.env.FUNCTIONS_EMULATOR === 'true' && !process.env.FIREBASE_DATABASE_EMULATOR_HOST) {
    throw new HttpsError('failed-precondition', 'Запустите эмулятор Realtime Database для COFFEEMAN')
  }
  const database = getDatabaseWithUrl(databaseURL)
  const tokenName = typeof token.name === 'string' ? token.name.trim() : ''
  const name = (tokenName || token.email?.split('@')[0] || 'Сотрудник').slice(0, 60)
  const actor: Session = { userId: uid, role, name, deviceId, demo: false }
  const now = Date.now()
  let failure: Error | undefined

  const result = await database.ref(namespace).transaction((value) => {
    failure = undefined
    try {
      if (value !== null && value.schemaVersion !== 1) {
        failure = new Error('Данные COFFEEMAN требуют проверки версии перед подключением')
        return value
      }
      const state = normalizeState(value)
      if (state.auditLogs[operationId]?.actorId && state.auditLogs[operationId].actorId !== uid) {
        failure = new Error('Идентификатор операции уже занят')
        return value
      }
      const next: State = applyCommand(state, actor, command as Command, { id: operationId, now })
      return next === state ? value : { ...value, ...withServerTimestamps(next, value, now) as object }
    } catch (error) {
      if (error instanceof DomainError) failure = error
      else {
        logger.warn('Rejected malformed COFFEEMAN command', { operationType: command.type })
        failure = new Error('Некорректные данные операции')
      }
      // RTDB may initially present an empty local cache. Submitting the
      // unchanged value lets the server check it and retry with live data.
      return value
    }
  }, undefined, false)

  if (failure || !result.committed) {
    throw new HttpsError('failed-precondition', failure?.message || 'Данные изменились. Повторите операцию')
  }
  return { operationId }
})
