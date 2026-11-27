import { initializeApp } from 'firebase/app'
import { get, getDatabase, onDisconnect, onValue, ref, remove, serverTimestamp, set, runTransaction } from 'firebase/database'
import type { Database } from 'firebase/database'
import { applyCommand, configureLocalVenue, emptyState, newId, normalizeState } from './domain'
import type { Command, Session } from './domain'
import { asError, connectionSubscribe, deviceId, presenceExpiryMs, presencePulseMs } from './device-store'
import type { Store, PresenceListener, ErrorListener } from './store'
function startFirebasePresence(database: Database, actor: Session, listener: PresenceListener, onError?: ErrorListener) {
  const path = ref(database, `coffeeman/presence/${actor.userId}/${newId()}`)
  let active = true
  let online = false
  let generation = 0
  let armed = false
  let offset = 0
  let leases: Record<string, Record<string, number>> = {}
  let published: string | undefined

  function report(error: unknown) {
    if (active && online) onError?.(asError(error))
  }

  function publish() {
    const cutoff = Date.now() + offset - presenceExpiryMs
    const users = new Set(Object.keys(leases).filter(uid =>
      Object.values(leases[uid] ?? {}).some(at => typeof at === 'number' && at > cutoff),
    ))
    const signature = [...users].sort().join(',')
    if (signature === published) return
    published = signature
    listener(users)
  }

  function renew() {
    if (active && online && armed) void set(path, serverTimestamp()).catch(report)
  }

  const unsubscribeConnection = onValue(ref(database, '.info/connected'), snapshot => {
    online = snapshot.val() === true
    generation += 1
    armed = false
    if (!active || !online) return
    const current = generation
    // Register the disconnect cleanup before making the connection visible.
    void onDisconnect(path).remove().then(() => {
      if (!active || !online || generation !== current) return
      armed = true
      renew()
    }).catch(report)
  }, report)

  const admin = actor.role === 'admin'
  const unsubscribeLeases = admin && onValue(ref(database, 'coffeeman/presence'), snapshot => {
    leases = snapshot.val() ?? {}
    publish()
  }, report)
  const unsubscribeOffset = admin && onValue(ref(database, '.info/serverTimeOffset'), snapshot => {
    const value: unknown = snapshot.val()
    offset = typeof value === 'number' ? value : 0
    publish()
  }, report)

  publish()
  const interval = window.setInterval(() => {
    renew()
    if (admin) publish()
  }, presencePulseMs)

  return async () => {
    active = false
    window.clearInterval(interval)
    unsubscribeConnection()
    if (unsubscribeLeases) unsubscribeLeases()
    if (unsubscribeOffset) unsubscribeOffset()
    if (!online) return
    // The queued server cleanup also covers a connection lost during logout.
    await remove(path).catch(() => undefined)
  }
}


export function createFirebaseStore(): Store {
 const database = getDatabase(initializeApp({
 apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
 authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
 databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
 projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
 appId: import.meta.env.VITE_FIREBASE_APP_ID,
 }, 'COFFEEMAN'))
 const root = ref(database, 'coffeeman')
 const key = 'coffeeman.cloud.session.v2'
 let session: Session | null = null
 let connected = false
 type Pending = {actor:Session;command:Command;id:string;now:number}
 const queueKey='coffeeman.pending.v1'
 let queue:Pending[] = JSON.parse(localStorage.getItem(queueKey) || '[]')
 let base=emptyState(), loaded=false, flushing=false
 const listeners=new Set<(state:ReturnType<typeof emptyState>)=>void>()
 function persist(){localStorage.setItem(queueKey,JSON.stringify(queue))}
 function projected(){let state=base;for(const p of queue){try{state=applyCommand(state,p.actor,p.command,{id:p.id,now:p.now})}catch{/* server conflict is reported during flush */}}return state}
 function publish(){for(const listener of listeners)listener(projected())}
 async function flush(){if(flushing||!connected||!queue.length)return;flushing=true;try{while(queue.length&&connected){const p=queue[0];try{await change(raw=>merge(raw,applyCommand(stateOf(raw),p.actor,p.command,{id:p.id,now:p.now})),p.id);base=normalizeState((await get(root)).val());queue.shift();persist();publish()}catch{break}}}finally{flushing=false}}
 window.setInterval(()=>{void flush()},10000)
 const alias = (name: string) => name.normalize('NFC').trim().replace(/\s+/g,' ').toLocaleLowerCase('ru-RU')
 async function change(transform: (raw: unknown) => unknown, operationId: string) {
 const warn = (code: string) => window.dispatchEvent(new CustomEvent('coffeeman-sync-error',{detail:{code,operationId}}))
 if (!navigator.onLine) { warn('network/offline'); throw new Error('Нет подключения к сети') }
 const timer = window.setInterval(()=>warn('sync/confirmation-pending'),10000)
 try {
 const result = await runTransaction(root, transform, {applyLocally:false})
 if (!result.committed) throw new Error('Операция не подтверждена')
 window.dispatchEvent(new CustomEvent('coffeeman-sync-confirmed',{detail:{operationId}}))
 } catch(e) { warn((e as {code?:string})?.code || 'sync/unknown'); throw e }
 finally { window.clearInterval(timer) }
 }
 function stateOf(raw: unknown) { return raw ? normalizeState(raw) : configureLocalVenue({...emptyState(),sampleDataRemoved:true},Date.now()) }
 function merge(raw: unknown, next: ReturnType<typeof stateOf>) { return JSON.parse(JSON.stringify({...((raw ?? {}) as object),...next})) }
 return {
 mode:'firebase',
 subscribe(listener,onError) { listeners.add(listener);if(loaded)listener(projected());const detach=onValue(root,s=>{base=normalizeState(s.val());loaded=true;publish()},e=>onError?.(asError(e)));return ()=>{listeners.delete(listener);detach()} },
 subscribeConnection(listener) {
 const stop = connectionSubscribe(listener,()=>!navigator.onLine?'offline':connected?'online':'connecting')
 const detach=onValue(ref(database,'.info/connected'),s=>{connected=s.val()===true;listener(connected?'online':'offline');if(connected)void flush()},()=>listener('offline'))
 return ()=>{stop();detach()}
 },
 subscribePresence(listener,onError) { if (!session) {listener(new Set());return ()=>undefined} const close=startFirebasePresence(database,session,listener,onError);return ()=>{void close()} },
 async login(input,remember) {
 const name=input.normalize('NFC').trim().replace(/\s+/g,' ')
 if (!name || name.length>60) throw new Error('Введите имя длиной от 1 до 60 символов')
 const ownDevice=await deviceId(), id=newId(), op=newId(), now=Date.now()
 const admin=alias(name)==='admin'
 let actor: Session | undefined
 await get(root)
 await change(raw=>{
 const state=stateOf(raw)
 const matches=Object.values(state.users).filter(u=>admin?u.role==='admin':u.role==='waiter'&&alias(u.name)===alias(name))
 if(matches.length>1) throw new Error('Несколько профилей с таким именем. Обратитесь к администратору')
 const match=matches[0]
 actor={userId:match?.id ?? (admin?'demo-admin':id),deviceId:ownDevice,demo:false,role:admin?'admin':'waiter',name:match?.name??(admin?'Администратор':name)}
 return merge(raw,applyCommand(state,actor,{type:'registerUser'},{id:op,now}))
 },op)
 if(!actor) throw new Error('Вход не подтверждён')
 session=actor
 sessionStorage.setItem(key,JSON.stringify(actor))
 if(remember)localStorage.setItem(key,JSON.stringify(actor));else localStorage.removeItem(key)
 return actor
 },
 async restore(){
 const raw=sessionStorage.getItem(key)??localStorage.getItem(key)
 if(!raw)return null
 const saved=JSON.parse(raw) as Session
 if(saved.deviceId!==await deviceId())return null
 const user=normalizeState((await get(root)).val()).users[saved.userId]
 if(!user?.active)return null
 return session={...saved,name:user.name,role:user.role,demo:false}
 },
 async logout(){session=null;sessionStorage.removeItem(key);localStorage.removeItem(key)},
 async dispatch(command:Command,operationId=newId()){
 const actor=session
 if(!actor)throw new Error('Сначала войдите в систему')
 const now=Date.now()
 if(!loaded)throw new Error('Дождитесь загрузки данных')
 applyCommand(projected(),actor,command,{id:operationId,now})
 queue.push({actor,command,id:operationId,now});try{persist()}catch(e){queue.pop();throw e}publish();void flush()
 }
 }
}
