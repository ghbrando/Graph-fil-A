import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as firebaseSignOut,
} from 'firebase/auth'
import { auth } from './firebase'

export async function signIn(email: string, password: string): Promise<void> {
  await signInWithEmailAndPassword(auth, email, password)
}

export async function signUp(email: string, password: string): Promise<void> {
  await createUserWithEmailAndPassword(auth, email, password)
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
    default:
      return 'Something went wrong. Please try again'
  }
}
