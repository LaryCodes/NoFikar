import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { Family, FamilyMember, Profile } from '@/types';

interface AppState {
  user: Profile | null;
  currentFamily: Family | null;
  familyMembers: FamilyMember[];
  locationSharingEnabled: boolean;
  
  setUser: (user: Profile | null) => void;
  setCurrentFamily: (family: Family | null) => void;
  setFamilyMembers: (members: FamilyMember[]) => void;
  setLocationSharing: (enabled: boolean) => void;
  reset: () => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      user: null,
      currentFamily: null,
      familyMembers: [],
      locationSharingEnabled: false,
      
      setUser: (user) => set({ user }),
      setCurrentFamily: (family) => set({ currentFamily: family }),
      setFamilyMembers: (members) => set({ familyMembers: members }),
      setLocationSharing: (enabled) => set({ locationSharingEnabled: enabled }),
      reset: () => set({
        user: null,
        currentFamily: null,
        familyMembers: [],
        locationSharingEnabled: false,
      }),
    }),
    {
      name: 'nofikar-storage',
      // locationSharingEnabled is deliberately NOT persisted. It reflects
      // whether a live geolocation watch is currently running in this tab.
      // Persisting it made the UI show "LIVE" after a reload even though no
      // watch existed, and hid the Start Sharing button.
      partialize: (state) => ({
        user: state.user,
        currentFamily: state.currentFamily,
        familyMembers: state.familyMembers,
      }),
    }
  )
);
