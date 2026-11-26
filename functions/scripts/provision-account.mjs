import { randomBytes } from 'node:crypto'
import { initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'

const [projectId, email, role, displayName] = process.argv.slice(2)
if (!projectId || !email || !displayName || !['admin', 'waiter'].includes(role)) {
  console.error('Usage: npm run account -- <project-id> <email> <admin|waiter> <display-name>')
  process.exit(1)
}

initializeApp({ projectId })
const auth = getAuth()
let account
try {
  account = await auth.getUserByEmail(email)
} catch (error) {
  if (error.code !== 'auth/user-not-found') throw error
  account = await auth.createUser({
    email, displayName,
    password: process.env.COFFEEMAN_ACCOUNT_PASSWORD || randomBytes(32).toString('base64url'),
  })
}
const currentRole = account.customClaims?.coffeemanRole
if (currentRole && currentRole !== role) {
  throw new Error('The account already has a different COFFEEMAN role. Review the profile migration first.')
}
await auth.setCustomUserClaims(account.uid, { ...account.customClaims, coffeemanRole: role })
console.log(`COFFEEMAN role ${role} assigned to UID ${account.uid}`)
