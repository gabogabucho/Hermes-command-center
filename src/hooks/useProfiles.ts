import { useCallback, useEffect, useState } from 'react';

export interface CronJob {
  id: string;
  name: string;
  schedule: string | null;
  enabled: boolean;
  lastModifiedAgo: string | null;
}

export interface ProfileSessions {
  count: number;
  lastActiveAt: number | null;
  lastActiveAgo: string | null;
}

export interface ProfileData {
  id: string;
  name: string;
  path: string;
  isActive: boolean;
  model: string | null;
  provider: string | null;
  sessions: ProfileSessions;
  cronJobs: { count: number; enabled: number; jobs: CronJob[] };
  skillCount: number;
  memoryCount: number;
  hasLogs: boolean;
  error?: string;
}

export interface ProfilesSnapshot {
  hermesHome: string;
  activeProfile: string | null;
  profileCount: number;
  profiles: ProfileData[];
  generatedAt: string;
}

export interface UseProfilesReturn {
  snapshot: ProfilesSnapshot | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

const POLL_INTERVAL_MS = 30_000; // refresh every 30s

export function useProfiles(): UseProfilesReturn {
  const [snapshot, setSnapshot] = useState<ProfilesSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetch_ = useCallback(async () => {
    try {
      const res = await fetch('/api/profiles');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as ProfilesSnapshot;
      setSnapshot(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'profiles fetch failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetch_();
    const interval = setInterval(() => void fetch_(), POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetch_]);

  return { snapshot, loading, error, refresh: fetch_ };
}
