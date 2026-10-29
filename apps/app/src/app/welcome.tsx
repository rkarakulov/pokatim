import type { LoaderFunction } from 'expo-router/server';

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
  return <LandingScreen seed={useLoaderSeed<LandingSeed>()} />;
}
