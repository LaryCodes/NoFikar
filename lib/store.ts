import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { Family, FamilyMember, Profile, SosContext } from '@/types';

/**
 * An SOS raised on this device, held locally so the emergency state survives a
 * refresh and is visible even before (or without) the row reaching Supabase.
 * `id` is the same client-generated UUID the synced row will carry, so the
 * banner can de-duplicate local and server copies of the same emergency.
 */
export interface LocalSos {
  id: string;
  familyId: string;
  createdAt: string;
  data: SosContext;
  /** True until the sync engine has confirmed the family can see it. */
  queued: boolean;
}

interface AppState {
  user: Profile | null;
  currentFamily: Family | null;
  familyMembers: FamilyMember[];
  locationSharingEnabled: boolean;
  localSos: LocalSos | null;
  /** Set by "View location" so the Map tab knows who to focus and select. */
  focusMember: { userId: string; at: number } | null;

  setUser: (user: Profile | null) => void;
  setCurrentFamily: (family: Family | null) => void;
  setFamilyMembers: (members: FamilyMember[]) => void;
  setLocationSharing: (enabled: boolean) => void;
  setLocalSos: (sos: LocalSos | null) => void;
  focusOnMember: (userId: string) => void;
  clearFocusMember: () => void;
  reset: () => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      user: null,
      currentFamily: null,
      familyMembers: [],
      locationSharingEnabled: false,
      localSos: null,
      focusMember: null,

      setUser: (user) => set({ user }),
      setCurrentFamily: (family) => set({ currentFamily: family }),
      setFamilyMembers: (members) => set({ familyMembers: members }),
      setLocationSharing: (enabled) => set({ locationSharingEnabled: enabled }),
      setLocalSos: (localSos) => set({ localSos }),
      // Timestamped so tapping "View location" twice for the same person still
      // re-triggers the map focus effect.
      focusOnMember: (userId) => set({ focusMember: { userId, at: Date.now() } }),
      clearFocusMember: () => set({ focusMember: null }),
      reset: () => set({
        user: null,
        currentFamily: null,
        familyMembers: [],
        locationSharingEnabled: false,
        localSos: null,
        focusMember: null,
      }),
    }),
    {
      name: 'nofikar-storage',
      // locationSharingEnabled is deliberately NOT persisted. It reflects
      // whether a live geolocation watch is currently running in this tab.
      // Persisting it made the UI show "LIVE" after a reload even though no
      // watch existed, and hid the Start Sharing button.
      //
      // localSos IS persisted: an unresolved emergency must not disappear
      // because the phone's browser reloaded the page.
      partialize: (state) => ({
        user: state.user,
        currentFamily: state.currentFamily,
        familyMembers: state.familyMembers,
        localSos: state.localSos,
      }),
    }
  )
);
