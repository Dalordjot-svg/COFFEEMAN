import { newId } from './domain'
import type { Connection } from './store'

export function asError(error: unknown) {
  return error instanceof Error ? error : new Error('Не удалось выполнить операцию')
}

let browserDatabase: Promise<IDBDatabase> | undefined

function openBrowserDatabase(): Promise<IDBDatabase> {
  if (browserDatabase) return browserDatabase
  browserDatabase = new Promise<IDBDatabase>((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error('Браузер заблокировал локальное хранилище COFFEEMAN'))
      return
    }
    const request = window.indexedDB.open('coffeeman-device-v1', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('values')
    request.onsuccess = () => {
      request.result.onversionchange = () => {
        request.result.close()
        browserDatabase = undefined
      }
      resolve(request.result)
    }
    request.onerror = () => reject(new Error('Не удалось открыть локальное хранилище COFFEEMAN'))
    request.onblocked = () => reject(new Error('Закройте старые вкладки COFFEEMAN и попробуйте снова'))
  }).catch((error) => {
    browserDatabase = undefined
    throw error
  })
  return browserDatabase
}

export async function browserValue<T>(
  key: string,
  read: (current: T | undefined) => T,
  write = true,
): Promise<T> {
  const database = await openBrowserDatabase()
  return new Promise<T>((resolve, reject) => {
    const transaction = database.transaction('values', write ? 'readwrite' : 'readonly')
    const values = transaction.objectStore('values')
    const request = values.get(key)
    let value: T
    let failure: unknown
    request.onsuccess = () => {
      try {
        value = read(request.result as T | undefined)
        if (write && value !== request.result) values.put(value, key)
      } catch (error) {
        failure = error
        transaction.abort()
      }
    }
    transaction.oncomplete = () => resolve(value)
    transaction.onabort = () => reject(failure ?? transaction.error ?? new Error('Локальное сохранение прервано'))
    transaction.onerror = () => reject(failure ?? transaction.error ?? new Error('Ошибка локального сохранения'))
  })
}

export function deviceId() {
  return browserValue<string>('deviceId', (value) => value ?? newId())
}

export function connectionSubscribe(listener: (value: Connection) => void, network: () => Connection) {
  const publish = () => listener(network())
  window.addEventListener('online', publish)
  window.addEventListener('offline', publish)
  publish()
  return () => {
    window.removeEventListener('online', publish)
    window.removeEventListener('offline', publish)
  }
}
