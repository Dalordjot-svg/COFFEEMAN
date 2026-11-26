import { initializeApp } from 'firebase/app'
import {
  browserLocalPersistence, browserSessionPersistence, connectAuthEmulator,
  getAuth, getIdTokenResult, setPersistence, signInWithEmailAndPassword, signOut,
} from 'firebase/auth'
import type { User as AuthUser } from 'firebase/auth'
import { connectDatabaseEmulator, get, getDatabase, onValue, ref } from 'firebase/database'
import { connectFunctionsEmulator, getFunctions, httpsCallable } from 'firebase/functions'
import { emptyState, newId, normalizeState } from './domain'
import type { Command, Session, State, User } from './domain'
import { asError, connectionSubscribe, deviceId } from './device-store'
import type { CommandResult, Connection, ErrorListener, Listener, Store } from './store'

const sharedCollections = [
  'users', 'categories', 'products', 'modifiers', 'halls', 'tables',
  'orders', 'inventory', 'inventoryReservations', 'notifications', 'settings',
] as const

export function createFirebaseStore(): Store {
  const config = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
  }
  const configurationError = Object.values(config).some((entry) => !entry) ?
    new Error('Для рабочего режима заполните параметры Firebase, включая точный databaseURL') : undefined

  function connect() {
    if (configurationError) throw configurationError
    const app = initializeApp(config, 'COFFEEMAN')
    const auth = getAuth(app)
    const database = getDatabase(app)
    const functions = getFunctions(app, import.meta.env.VITE_FIREBASE_FUNCTIONS_REGION || 'us-central1')
    const host = import.meta.env.VITE_FIREBASE_EMULATOR_HOST
    if (host) {
      if (!['localhost', '127.0.0.1'].includes(host) || !config.projectId?.startsWith('demo-')) {
        throw new Error('Для эмуляторов Firebase требуется локальный хост и демонстрационный ID проекта')
      }
      connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true })
      connectDatabaseEmulator(database, host, 9000)
      connectFunctionsEmulator(functions, host, 5001)
    }
    return { auth, database, functions }
  }

  let connection: ReturnType<typeof connect> | undefined
  const services = () => connection ??= connect()
  let session: Session | null = null
  let current: State | undefined
  let unsubscribe: (() => void)[] = []
  const listeners = new Map<Listener, ErrorListener | undefined>()

  function stop() {
    for (const detach of unsubscribe) detach()
    unsubscribe = []
    current = undefined
  }

  function publish(state: State) {
    current = state
    for (const listener of listeners.keys()) listener(state)
  }

  function report(error: unknown) {
    for (const listener of listeners.values()) listener?.(asError(error))
  }

  function watch() {
    if (!session || !listeners.size || unsubscribe.length) return
    const actor = session
    const { database } = services()
    const collections = session.role === 'admin' ?
      [...sharedCollections, 'devices', 'inventoryTransactions', 'auditLogs'] as const : sharedCollections
    const pending = new Set<string>(collections)
    const partial: Record<string, unknown> = { schemaVersion: emptyState().schemaVersion }
    let scheduled = false
    let active = true
    unsubscribe = collections.map((key) => onValue(ref(database, `coffeeman/${key}`), (snapshot) => {
      partial[key] = snapshot.val()
      pending.delete(key)
      if (pending.size || scheduled) return
      scheduled = true
      queueMicrotask(() => {
        scheduled = false
        if (!active) return
        try { publish(normalizeState(partial)) } catch (error) { report(error) }
      })
    }, (error) => {
      report(new Error(`Доступ к данным Firebase ограничен. ${error.message}`))
    }))
    unsubscribe.push(onValue(ref(database, `coffeeman/users/${actor.userId}`), (snapshot) => {
      const user = snapshot.val() as User | null
      if (user?.active && user.role === actor.role) return
      queueMicrotask(() => {
        if (!active) return
        stop()
        const state = emptyState()
        state.users[actor.userId] = {
          id: actor.userId, name: user?.name ?? actor.name, role: actor.role, active: false,
          createdAt: user?.createdAt ?? 0, lastSeenAt: user?.lastSeenAt ?? 0,
        }
        publish(state)
      })
    }, report))
    unsubscribe.push(() => { active = false })
  }

  function firebaseMessage(error: unknown) {
    const code = (error as { code?: string })?.code
    if (code === 'auth/invalid-credential' || code === 'auth/user-not-found' || code === 'auth/wrong-password') {
      return new Error('Проверьте адрес электронной почты и пароль')
    }
    if (code === 'auth/user-disabled') return new Error('Доступ сотрудника отключён')
    if (code === 'auth/too-many-requests') return new Error('Слишком много попыток входа. Повторите позже')
    if (code === 'auth/network-request-failed' || code === 'functions/unavailable') {
      return new Error('Нет связи с Firebase. Проверьте подключение и повторите попытку')
    }
    return asError(error)
  }

  async function execute(command: Command, operationId = newId()) {
    if (!navigator.onLine) throw new Error('Для изменения рабочих данных требуется подключение')
    const { functions } = services()
    const call = httpsCallable<{ command: Command; operationId: string; deviceId: string }, CommandResult>(
      functions, 'coffeemanCommand', { timeout: 20000 },
    )
    try {
      // Firebase callable encoding converts undefined values to null.
      const payload = JSON.parse(JSON.stringify(command)) as Command
      return (await call({ command: payload, operationId, deviceId: await deviceId() })).data
    } catch (error) {
      throw firebaseMessage(error)
    }
  }

  async function establish(user: AuthUser, register: boolean): Promise<Session> {
    const token = await getIdTokenResult(user)
    const role = token.claims.coffeemanRole
    if (role !== 'admin' && role !== 'waiter') throw new Error('Для аккаунта не назначен доступ к COFFEEMAN')
    const name = token.claims.name
    const actor: Session = {
      userId: user.uid, deviceId: await deviceId(), role, demo: false,
      name: typeof name === 'string' && name.trim() ? name.trim() : user.email?.split('@')[0] || 'Сотрудник',
    }
    if (register) {
      await execute({ type: 'registerUser' })
    } else if (navigator.onLine) {
      const snapshot = await get(ref(services().database, `coffeeman/users/${user.uid}`))
      const profile = snapshot.val() as User | null
      if (!profile) await execute({ type: 'registerUser' })
      else if (!profile.active || profile.role !== role) throw new Error('Учётная запись недоступна')
      else actor.name = profile.name
    }
    session = actor
    watch()
    return actor
  }

  return {
    mode: 'firebase',

    subscribe(listener, onError) {
      listeners.set(listener, onError)
      if (current) listener(current)
      try { watch() } catch (error) { onError?.(asError(error)) }
      return () => {
        listeners.delete(listener)
        if (!listeners.size) stop()
      }
    },

    subscribeConnection(listener) {
      let connected: boolean | undefined
      const detachNetwork = connectionSubscribe(listener, () => {
        if (!navigator.onLine || connected === false || configurationError) return 'offline'
        return connected ? 'online' : 'connecting'
      })
      if (configurationError) return detachNetwork
      try {
        const detachFirebase = onValue(ref(services().database, '.info/connected'), (snapshot) => {
          connected = snapshot.val() === true
          listener(connected ? 'online' : 'offline')
        }, () => listener('offline'))
        return () => {
          detachFirebase()
          detachNetwork()
        }
      } catch {
        listener('offline')
        return detachNetwork
      }
    },

    async login(email, remember, password) {
      if (!email.trim() || !password) throw new Error('Введите адрес электронной почты и пароль')
      const { auth } = services()
      await setPersistence(auth, remember ? browserLocalPersistence : browserSessionPersistence)
      try {
        const credential = await signInWithEmailAndPassword(auth, email.trim(), password)
        return await establish(credential.user, true)
      } catch (error) {
        if (auth.currentUser) await signOut(auth)
        throw firebaseMessage(error)
      }
    },

    async restore() {
      if (configurationError) return null
      const { auth } = services()
      await auth.authStateReady()
      if (!auth.currentUser) return null
      try {
        return await establish(auth.currentUser, false)
      } catch (error) {
        throw firebaseMessage(error)
      }
    },

    async logout() {
      session = null
      stop()
      await signOut(services().auth)
    },

    async dispatch(command, operationId) {
      if (!session) throw new Error('Сначала войдите в систему')
      await execute(command, operationId)
    },
  }
}
