import { Redirect } from 'expo-router';
import type { LoaderFunction } from 'expo-router/server';

import { useRegistrationStore } from '@/features/auth/registration-store';

import { LandingScreen } from '@/features/landing/landing-screen';
import { landingMetadata } from '@/features/landing/metadata';
import { loadLandingSeed, type LandingSeed } from '@/features/landing/ssr';
import { useLoaderSeed } from '@/lib/loader-seed';

/*
 * Гостевой лендинг `/welcome` (guest-landing, RC-1): корневой экран в `Stack.Protected guard={!signedIn}` рядом с
 * `(onboarding)` — вошедший уходит на `/`. SSR: `loader` сеет четыре публичных списка, мета — без запросов.
 */

export const loader: LoaderFunction<LandingSeed> = () => loadLandingSeed();

export const generateMetadata = landingMetadata;

export default function WelcomeRoute() {
  const seed = useLoaderSeed<LandingSeed>();
  // живая регистрация (`resumeOnLaunch`): стор регистрации гидрируется отдельно от сессии и может прийти позже гарда
  // вкладок — тогда гость уже здесь; продолжение к «Подтвердите e-mail» запускает «Регистрация». На SSR стор пуст
  const resumeRegistration = useRegistrationStore((state) => state.resumeOnLaunch);
  if (resumeRegistration) return <Redirect href="/register" />;
  return <LandingScreen seed={seed} />;
}
