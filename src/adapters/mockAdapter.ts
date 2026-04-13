import { mockFleetSnapshot } from '../data/mockSnapshot';
import type { FleetSnapshot, HermesAdapter } from './types';

export const mockAdapter: HermesAdapter = {
  id: 'mock-hermes-fleet',
  label: 'Mock Hermes Fleet',
  async getFleetSnapshot(): Promise<FleetSnapshot> {
    return mockFleetSnapshot;
  },
};
