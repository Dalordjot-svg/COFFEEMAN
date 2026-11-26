import {
  applyCommand, createDemoState, newId, normalizeState,
} from './domain'
import type { Command, Session, State } from './domain'
import { asError, browserValue, connectionSubscribe, deviceId } from './device-store'

export type Connection = 'online' | 'offline' | 'connecting' | 'demo'
export type Listener = (state: State) => void
export type ErrorListener = (error: Error) => void
export type CommandResult = { operationId: string }

export interface Store {
  readonly mode: 'demo' | 'firebase'
  subscribe(listener: Listener, onError?: ErrorListener): () => void
  subscribeConnection(listener: (connection: Connection) => void): () => void
  login(nameOrEmail: string, remember: boolean, password?: string): Promise<Session>
  restore(): Promise<Session | null>
  logout(): Promise<void>
  dispatch(command: Command, operationId?: string): Promise<void>
}

const demoSessionKey = 'coffeeman.demo.session.v1'
const revisionKey = 'coffeeman.demo.revision.v1'
const stateKey = 'demoState'

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

function createDemoStore(): Store {
  let session: Session | null = null
  let ready: Promise<State> | undefined
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

  async function execute(actor: Session, command: Command, operationId = newId()) {
    await initialize()
    const state = await browserValue<State>(stateKey, (value) => {
      return applyCommand(normalizeState(value), actor, command, { id: operationId, now: Date.now() })
    })
    publish(state)
    writeWebStorage('localStorage', revisionKey, newId())
    channel?.postMessage(revisionKey)
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

    async login(input, remember) {
      const name = input.trim().replace(/\s+/g, ' ')
      if (!name || name.length > 60) throw new Error('Введите имя длиной от 1 до 60 символов')
      const alias = name.toLocaleLowerCase('ru-RU')
      const admin = alias === 'admin'
      const pasha = alias === 'паша'
      const ownDevice = await deviceId()
      const userId = admin ? 'demo-admin' : pasha ? 'demo-pasha' :
        await browserValue<string>(`demoUser:${alias}`, (value) => value ?? newId())
      const actor: Session = {
        userId, deviceId: ownDevice, demo: true,
        role: admin ? 'admin' : 'waiter',
        name: admin ? 'Администратор' : pasha ? 'Паша' : name,
      }
      await execute(actor, { type: 'registerUser' })
      session = actor
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
