import { useEffect, useState } from 'react';
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  type User,
} from 'firebase/auth';
import { auth } from './firebase';

export function useAuthUser(): { user: User | null; ready: boolean } {
  const [state, setState] = useState<{ user: User | null; ready: boolean }>({
    user: auth.currentUser,
    ready: false,
  });
  useEffect(() => onAuthStateChanged(auth, (user) => setState({ user, ready: true })), []);
  return state;
}

export async function signIn(email: string, password: string) {
  await signInWithEmailAndPassword(auth, email, password);
}

export async function signUp(email: string, password: string) {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  await sendEmailVerification(cred.user).catch(() => undefined);
}

export async function resetPassword(email: string) {
  await sendPasswordResetEmail(auth, email);
}

export async function signOut() {
  await fbSignOut(auth);
}

/** Firebase auth error codes → Danish. */
export function authErrorMessage(err: unknown): string {
  const code = (err as { code?: string }).code ?? '';
  switch (code) {
    case 'auth/invalid-email':
      return 'E-mailadressen er ugyldig.';
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Forkert e-mail eller adgangskode.';
    case 'auth/email-already-in-use':
      return 'Der findes allerede en konto med den e-mail.';
    case 'auth/weak-password':
      return 'Adgangskoden skal være mindst 6 tegn.';
    case 'auth/too-many-requests':
      return 'For mange forsøg. Vent lidt og prøv igen.';
    case 'auth/network-request-failed':
      return 'Ingen forbindelse. Prøv igen, når du er online.';
    default:
      return 'Noget gik galt. Prøv igen.';
  }
}
