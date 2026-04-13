import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_SKIN, SKINS, type SkinDefinition } from '../skins/registry';

const STORAGE_KEY = 'hcc_skin';

function readStoredSkin(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? DEFAULT_SKIN;
  } catch {
    return DEFAULT_SKIN;
  }
}

function applySkin(skinId: string): void {
  document.documentElement.setAttribute('data-skin', skinId);
}

export interface UseSkinReturn {
  activeSkin: string;
  skins: SkinDefinition[];
  setSkin: (id: string) => void;
}

export function useSkin(): UseSkinReturn {
  const [activeSkin, setActiveSkin] = useState<string>(readStoredSkin);

  // Apply on mount and whenever skin changes
  useEffect(() => {
    applySkin(activeSkin);
  }, [activeSkin]);

  const setSkin = useCallback((id: string) => {
    const valid = SKINS.some((s) => s.id === id);
    const next = valid ? id : DEFAULT_SKIN;
    try { localStorage.setItem(STORAGE_KEY, next); } catch { /* noop */ }
    setActiveSkin(next);
  }, []);

  return { activeSkin, skins: SKINS, setSkin };
}
