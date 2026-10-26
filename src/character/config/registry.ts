/**
 * Character registry.
 *
 * Built-in characters are compiled in; user characters are imported locally
 * (see character_import/) and fetched from the backend, which serves them
 * from the user's data folder. Both resolve to the same CharacterConfig.
 */
import type { CharacterConfig } from './types';
import type { CharacterProfile } from '@/shared/character/profile';
import { configFromProfile } from './fromProfile';

/**
 * Public installers (npm run dist:public) ship without the bundled model:
 * its licence forbids redistribution. Each user imports their own character.
 */
export const PUBLIC_BUILD = import.meta.env.VITE_HASU_PUBLIC === '1';

/**
 * Characters compiled into the app. The source pack bundles no model (see
 * README), so this is empty: every character is imported by the user. To
 * bundle one, stage it under assets/characters/ and register its config here.
 */
const BUILT_IN: CharacterConfig[] = [];

export const CHARACTERS: Record<string, CharacterConfig> = PUBLIC_BUILD
  ? {}
  : Object.fromEntries(BUILT_IN.map((c) => [c.id, c]));

/** True when there is a compiled-in character to fall back to. */
const HAS_BUILT_IN = Object.keys(CHARACTERS).length > 0;

/** First built-in character, or '' when every character must be imported. */
export const DEFAULT_CHARACTER_ID = Object.keys(CHARACTERS)[0] ?? '';

/** Raised when there is no character to show yet (nothing built in or imported). */
export const NO_CHARACTER = 'NO_CHARACTER';

export function getCharacterConfig(id: string = DEFAULT_CHARACTER_ID): CharacterConfig {
  const config = CHARACTERS[id] ?? CHARACTERS[DEFAULT_CHARACTER_ID];
  if (!config) throw new Error(NO_CHARACTER);
  return config;
}

export function isBuiltInCharacter(id: string): boolean {
  return id in CHARACTERS;
}

export interface CharacterListing {
  id: string;
  displayName: string;
  source: 'built-in' | 'user';
  restrictions?: string[];
  summary?: { supported: number; partial: number; unsupported: number; testsPassed: number; testsFailed: number };
}

export function listCharacters(): Array<{ id: string; displayName: string }> {
  return Object.values(CHARACTERS).map((c) => ({ id: c.id, displayName: c.displayName }));
}

/** Built-in plus locally imported characters. */
export async function listAllCharacters(): Promise<CharacterListing[]> {
  const builtIn: CharacterListing[] = Object.values(CHARACTERS).map((c) => ({ id: c.id, displayName: c.displayName, source: 'built-in' }));
  try {
    const response = await fetch('/api/characters');
    if (!response.ok) return builtIn;
    const users = (await response.json()) as Array<{ id: string; displayName: string; restrictions: string[]; summary: CharacterListing['summary'] }>;
    return [...builtIn, ...users.filter((u) => !(u.id in CHARACTERS)).map((u) => ({ id: u.id, displayName: u.displayName, source: 'user' as const, restrictions: u.restrictions, summary: u.summary }))];
  } catch {
    return builtIn;
  }
}

export async function fetchCharacterProfile(id: string): Promise<CharacterProfile> {
  const response = await fetch(`/api/characters/${encodeURIComponent(id)}`);
  if (!response.ok) throw new Error(`Character "${id}" is not available (${response.status}).`);
  return (await response.json()) as CharacterProfile;
}

/** Resolve any character id to a runnable config (and its profile if imported). */
export async function resolveCharacter(id: string | undefined): Promise<{ config: CharacterConfig; profile?: CharacterProfile }> {
  if (id && id in CHARACTERS) return { config: getCharacterConfig(id) };
  if (!id && HAS_BUILT_IN) return { config: getCharacterConfig() };
  if (!id) {
    // No built-in character: the first imported character, if any.
    const imported = (await listAllCharacters()).find((c) => c.source === 'user');
    if (!imported) throw new Error(NO_CHARACTER);
    id = imported.id;
  }
  try {
    const profile = await fetchCharacterProfile(id);
    return { config: configFromProfile(profile), profile };
  } catch (error) {
    if (HAS_BUILT_IN) throw error;
    // The chosen character was removed: fall back to any other import.
    const imported = (await listAllCharacters()).find((c) => c.source === 'user' && c.id !== id);
    if (!imported) throw new Error(NO_CHARACTER);
    const profile = await fetchCharacterProfile(imported.id);
    return { config: configFromProfile(profile), profile };
  }
}
