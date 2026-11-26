import {
  applyCommand, createDemoState, newId, normalizeState,
} from './domain'
import type { Command, Session, State } from './domain'
import { asError, browserValue, connectionSubscribe, deviceId, presenceExpiryMs, presencePulseMs } from './device-store'

export type Connection = 'online' | 'offline' | 'connecting' | 'demo'
export type Listener = (state: State) => void
export type ErrorListener = (error: Error) => void
export type PresenceListener = (onlineUserIds: ReadonlySet<string>) => void
export type CommandResult = { operationId: string }

export interface Store {
  readonly mode: 'demo' | 'firebase'
  subscribe(listener: Listener, onError?: ErrorListener): () => void
  subscribeConnection(listener: (connection: Connection) => void): () => void
  subscribePresence(listener: PresenceListener, onError?: ErrorListener): () => void
  login(nameOrEmail: string, remember: boolean, password?: string): Promise<Session>
  restore(): Promise<Session | null>
  logout(): Promise<void>
  dispatch(command: Command, operationId?: string): Promise<void>
}

const demoSessionKey = 'coffeeman.demo.session.v1'
const revisionKey = 'coffeeman.demo.revision.v1'
const stateKey = 'demoState'
const presencePrefix = 'coffeeman.demo.presence.v1.'

function readWebStorage(kind: 'localStorage' | 'sessionStorage', key: string): string | null {
  try { return window[kind].getItem(key) } catch { return null }
}

function writeWebStorage(kind: 'localStorage' | 'sessionStorage', key: string, value: string | null) {
  try {
    if (value === null) window[kind].removeItem(key)
    else window[kind].setItem(key, value)
  } catch {
    // The IndexedDB data remains available in browsers that block Web Storage.
  }
}

function compactName(name: string) {
  return name.normalize('NFC').trim().replace(/\s+/g, ' ')
}

function nameAlias(name: string) {
  return compactName(name).toLocaleLowerCase('ru-RU')
}

function startDemoPresence(actor: Session, listener: PresenceListener) {
  const key = presencePrefix + newId()
  let published: string | undefined
  let participating = true
  function publish() {
    const online = new Set<string>(participating ? [actor.userId] : [])
    const cutoff = Date.now() - presenceExpiryMs
    try {
      const storage = window.localStorage
      const expired: string[] = []
      for (let index = 0; index < storage.length; index++) {
        const entry = storage.key(index)
        if (!entry?.startsWith(presencePrefix)) continue
        let lease: { userId?: string; at?: number } | null = null
        try { lease = JSON.parse(storage.getItem(entry) ?? 'null') } catch { /* Ignore malformed local entries. */ }
        if (typeof lease?.userId === 'string' && typeof lease.at === 'number' && lease.at > cutoff) {
          online.add(lease.userId)
        } else {
          expired.push(entry)
        }
      }
      for (const entry of expired) storage.removeItem(entry)
    } catch { /* The active session remains visible when Web Storage is blocked. */ }
    const signature = [...online].sort().join(',')
    if (signature === published) return
    published = signature
    listener(online)
  }
  function pulse() {
    if (participating) writeWebStorage('localStorage', key, JSON.stringify({ userId: actor.userId, at: Date.now() }))
    publish()
  }
  function hide() {
    participating = false
    writeWebStorage('localStorage', key, null)
  }
  function show() {
    participating = true
    pulse()
  }
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key.startsWith(presencePrefix)) publish()
  }
  window.addEventListener('storage', onStorage)
  window.addEventListener('pagehide', hide)
  window.addEventListener('pageshow', show)
  const interval = window.setInterval(pulse, presencePulseMs)
  pulse()
  return () => {
    window.clearInterval(interval)
    window.removeEventListener('storage', onStorage)
    window.removeEventListener('pagehide', hide)
    window.removeEventListener('pageshow', show)
    hide()
  }
}

function createDemoStore(): Store {
  let session: Session | null = null
  let ready: Promise<State> | undefined
  const presenceStops = new Set<() => void>()
  const listeners = new Map<Listener, ErrorListener | undefined>()

  const initialize = () => {
    ready ??= browserValue<State>(stateKey, (value) => value ?? createDemoState())
      .catch((error) => {
        ready = undefined
        throw error
      })
    return ready
  }

  const publish = (state: State) => {
    for (const listener of listeners.keys()) listener(state)
  }

  const report = (error: unknown) => {
    for (const listener of listeners.values()) listener?.(asError(error))
  }

  async function refresh() {
    await initialize()
    publish(await browserValue<State>(stateKey, (value) => normalizeState(value), false))
  }

  function publishRevision(state: State) {
    publish(state)
    writeWebStorage('localStorage', revisionKey, newId())
    channel?.postMessage(revisionKey)
  }

  async function execute(actor: Session, command: Command, operationId = newId()) {
    await initialize()
    const state = await browserValue<State>(stateKey, (value) => {
      return applyCommand(normalizeState(value), actor, command, { id: operationId, now: Date.now() })
    })
    publishRevision(state)
    return { operationId }
  }

  let channel: BroadcastChannel | undefined
  const onStorage = (event: StorageEvent) => {
    if (event.key === revisionKey) void refresh().catch(report)
  }
  const onVisibility = () => {
    if (document.visibilityState === 'visible') void refresh().catch(report)
  }

  return {
    mode: 'demo',

    subscribe(listener, onError) {
      listeners.set(listener, onError)
      if (listeners.size === 1) {
        if ('BroadcastChannel' in window) {
          channel = new BroadcastChannel('coffeeman-demo')
          channel.onmessage = () => { void refresh().catch(report) }
        }
        window.addEventListener('storage', onStorage)
        document.addEventListener('visibilitychange', onVisibility)
      }
      void refresh().catch(report)
      return () => {
        listeners.delete(listener)
        if (!listeners.size) {
          channel?.close()
          channel = undefined
          window.removeEventListener('storage', onStorage)
          document.removeEventListener('visibilitychange', onVisibility)
        }
      }
    },

    subscribeConnection(listener) {
      return connectionSubscribe(listener, () => navigator.onLine ? 'demo' : 'offline')
    },

    subscribePresence(listener) {
      if (!session) {
        listener(new Set())
        return () => undefined
      }
      const detach = startDemoPresence(session, listener)
      const stop = () => {
        if (presenceStops.delete(stop)) detach()
      }
      presenceStops.add(stop)
      return stop
    },

    async login(input, remember) {
      const name = compactName(input)
      if (!name || name.length > 60) throw new Error('Введите имя длиной от 1 до 60 символов')
      const alias = nameAlias(name)
      const admin = alias === 'admin'
      const ownDevice = await deviceId()
      let actor!: Session
      await initialize()
      const next = await browserValue<State>(stateKey, (value) => {
        const previous = normalizeState(value)
        const matches = admin ? [] : Object.values(previous.users).filter((user) =>
          user.role === 'waiter' && nameAlias(user.name) === alias)
        if (matches.length > 1) {
          throw new Error('Есть несколько сотрудников с таким именем. Уточните имя у администратора')
        }
        const match = admin ? previous.users['demo-admin'] : matches[0]
        actor = {
          userId: admin ? 'demo-admin' : match?.id ?? newId(),
          deviceId: ownDevice, demo: true, role: admin ? 'admin' : 'waiter',
          name: match?.name ?? (admin ? 'Администратор' : name),
        }
        return applyCommand(previous, actor, { type: 'registerUser' }, { id: newId(), now: Date.now() })
      })
      session = actor
      publishRevision(next)
      const serialized = JSON.stringify(actor)
      writeWebStorage('sessionStorage', demoSessionKey, serialized)
      writeWebStorage('localStorage', demoSessionKey, remember ? serialized : null)
      return actor
    },

    async restore() {
      const raw = readWebStorage('sessionStorage', demoSessionKey) ??
        readWebStorage('localStorage', demoSessionKey)
      if (!raw) return null
      let remembered: Partial<Session>
      try { remembered = JSON.parse(raw) ?? {} } catch { return null }
      if (!remembered.userId || !remembered.deviceId) return null
      await initialize()
      const state = await browserValue<State>(stateKey, (value) => normalizeState(value), false)
      const user = state.users[remembered.userId]
      if (!user?.active || remembered.deviceId !== await deviceId()) return null
      session = {
        userId: user.id, deviceId: remembered.deviceId, demo: true, role: user.role, name: user.name,
      }
      return session
    },

    async logout() {
      for (const stop of presenceStops) stop()
      writeWebStorage('sessionStorage', demoSessionKey, null)
      const persistent = readWebStorage('localStorage', demoSessionKey)
      if (persistent) {
        try {
          if (!session || (JSON.parse(persistent) as Partial<Session>)?.userId === session.userId) {
            writeWebStorage('localStorage', demoSessionKey, null)
          }
        } catch {
          writeWebStorage('localStorage', demoSessionKey, null)
        }
      }
      session = null
    },

    async dispatch(command, operationId) {
      if (!session) throw new Error('Сначала войдите в систему')
      await execute(session, command, operationId)
    },
  }
}

function deferredFirebaseStore(): Store {
  let loading: Promise<Store> | undefined
  const load = () => loading ??= import('./firebase-store').then(module => module.createFirebaseStore())

  function subscribe(attach: (store: Store) => () => void, onError?: ErrorListener) {
    let active = true
    let unsubscribe: (() => void) | undefined
    void load().then((store) => {
      if (active) unsubscribe = attach(store)
    }).catch((error) => {
      if (active) onError?.(asError(error))
    })
    return () => {
      active = false
      unsubscribe?.()
    }
  }

  return {
    mode: 'firebase',
    subscribe: (listener, onError) => subscribe(store => store.subscribe(listener, onError), onError),
    subscribePresence: (listener, onError) => subscribe(store => store.subscribePresence(listener, onError), onError),
    subscribeConnection: listener => {
      listener(navigator.onLine ? 'connecting' : 'offline')
      return subscribe(store => store.subscribeConnection(listener), () => listener('offline'))
    },
    login: async (...arguments_) => (await load()).login(...arguments_),
    restore: async () => (await load()).restore(),
    logout: async () => (await load()).logout(),
    dispatch: async (...arguments_) => (await load()).dispatch(...arguments_),
  }
}

export const store = import.meta.env.VITE_APP_MODE === 'firebase' ? deferredFirebaseStore() : createDemoStore()
