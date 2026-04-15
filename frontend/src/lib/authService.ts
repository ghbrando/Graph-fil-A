import {
  type User,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as firebaseSignOut,
} from 'firebase/auth'
import { FirebaseError } from 'firebase/app'
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore'
import { auth, db } from './firebase'

export async function signIn(email: string, password: string): Promise<void> {
  await signInWithEmailAndPassword(auth, email, password)
}

async function createUserProfile(user: User, fallbackEmail: string): Promise<void> {
  await setDoc(doc(db, 'users', user.uid), {
    email: user.email ?? fallbackEmail,
    createdAt: serverTimestamp(),
    stats: {
      totalSessions: 0,
      totalNodes: 0,
      totalAudioMinutes: 0,
    },
  })
}

export async function ensureUserProfile(user: User): Promise<void> {
  const userRef = doc(db, 'users', user.uid)
  const existing = await getDoc(userRef)

  if (existing.exists()) {
    return
  }

  // Force-refresh token to avoid create-after-signup auth propagation races.
  await user.getIdToken(true)
  await createUserProfile(user, user.email ?? '')
}

export async function signUp(email: string, password: string): Promise<void> {
  const credential = await createUserWithEmailAndPassword(auth, email, password)

  // Force-refresh token before first Firestore write.
  await credential.user.getIdToken(true)

  try {
    await createUserProfile(credential.user, email)
  } catch (error) {
    // Retry once in case auth claims are not yet recognized by Firestore.
    if (
      error instanceof FirebaseError &&
      (error.code === 'permission-denied' || error.code === 'unauthenticated')
    ) {
      await credential.user.getIdToken(true)
      await createUserProfile(credential.user, email)
      return
    }

    throw error
  }
}

export async function signOut(): Promise<void> {
  await firebaseSignOut(auth)
}

export async function getToken(): Promise<string> {
  if (!auth.currentUser) {
    throw new Error('No user signed in')
  }
  return await auth.currentUser.getIdToken()
}

export function parseAuthError(error: unknown): string {
  if (!(error instanceof Error)) {
    return 'Something went wrong. Please try again'
  }

  const code = (error as { code?: string }).code

  switch (code) {
    case 'auth/user-not-found':
    case 'auth/wrong-password':
      return 'Invalid email or password'
    case 'auth/email-already-in-use':
      return 'An account with this email already exists'
    case 'auth/weak-password':
      return 'Password must be at least 6 characters'
    case 'auth/invalid-email':
      return 'Please enter a valid email address'
    case 'auth/too-many-requests':
      return 'Too many attempts. Please try again later'
    case 'auth/invalid-credential':
      return 'Invalid email or password'
    case 'permission-denied':
    case 'unauthenticated':
      return 'Account created, but profile setup failed. Please sign in again.'
    default:
      return 'Something went wrong. Please try again'
  }
}
