export interface LocationData {
  id?: string;
  user_id: string;
  family_id: string;
  latitude: number;
  longitude: number;
  speed: number;
  accuracy: number;
  activity_status: string;
  battery_level?: number;
  created_at?: string;
}

export interface ActivityStatus {
  icon: string;
  label: string;
  color: string;
}

export interface Family {
  id: string;
  name: string;
  code: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface FamilyMember {
  id: string;
  family_id: string;
  user_id: string;
  role: 'admin' | 'member';
  name: string;
  avatar_url?: string;
  joined_at: string;
}

export interface Profile {
  id: string;
  email: string;
  name?: string;
  avatar_url?: string;
  battery_level?: number;
  location_sharing_enabled: boolean;
  notify_sos: boolean;
  notify_safe_zones: boolean;
  notify_low_battery: boolean;
  last_active: string;
  created_at: string;
  updated_at: string;
}

/** A family member joined with their profile, as returned by PostgREST embeds. */
export interface FamilyMemberWithProfile extends FamilyMember {
  profiles: Pick<
    Profile,
    "name" | "avatar_url" | "battery_level" | "location_sharing_enabled" | "last_active"
  > | null;
}

export interface SafeZone {
  id: string;
  family_id: string;
  name: string;
  latitude: number;
  longitude: number;
  radius: number;
  created_by?: string;
  notify_on_entry: boolean;
  notify_on_exit: boolean;
  created_at: string;
  updated_at: string;
}

export interface Alert {
  id: string;
  family_id: string;
  user_id?: string;
  type: string;
  title: string;
  message?: string;
  data?: any;
  read: boolean;
  created_at: string;
}

export interface EmergencyContact {
  id: string;
  user_id: string;
  name: string;
  phone: string;
  relationship?: string;
  created_at: string;
}

/**
 * Snapshot attached to an SOS so the family sees actionable context instead of
 * just "someone pressed SOS". Every field is optional because it is only ever
 * populated from data the device actually reported — nothing is invented.
 */
export interface SosContext {
  latitude?: number;
  longitude?: number;
  accuracy?: number;
  battery_level?: number | null;
  activity_status?: string;
  speed?: number;
  online?: boolean;
  triggered_at?: string;
}

export interface EmergencySession {
  id: string;
  family_id: string;
  requester_id: string;
  /** For an SOS this equals requester_id: it is addressed to the whole family. */
  target_id: string;
  session_type: 'camera' | 'audio' | 'sos';
  status:
    | 'pending'
    | 'approved'
    | 'rejected'
    | 'expired'
    | 'active'
    | 'ended'
    | 'resolved';
  data?: SosContext | null;
  acknowledged_by?: string | null;
  acknowledged_at?: string | null;
  expires_at?: string;
  approved_at?: string;
  ended_at?: string;
  created_at: string;
}

