-- NoFikar Production Database Schema

-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- User profiles table
-- Defined first because family_members, location_history, alerts, and
-- emergency_sessions all reference profiles(id) so PostgREST can embed it.
CREATE TABLE IF NOT EXISTS profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  avatar_url TEXT,
  battery_level INTEGER,
  location_sharing_enabled BOOLEAN DEFAULT false,
  notify_sos BOOLEAN DEFAULT true,
  notify_safe_zones BOOLEAN DEFAULT true,
  notify_low_battery BOOLEAN DEFAULT true,
  last_active TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Families table
CREATE TABLE IF NOT EXISTS families (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT UNIQUE NOT NULL, -- 6-digit join code
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Family members table
-- NOTE: user_id references profiles(id) (not auth.users) so PostgREST can
-- embed profile data via `select(*, profiles(...))`. profiles.id itself
-- references auth.users(id), so referential integrity is preserved.
CREATE TABLE IF NOT EXISTS family_members (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  family_id UUID REFERENCES families(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  role TEXT DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  name TEXT NOT NULL,
  avatar_url TEXT,
  joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(family_id, user_id)
);

-- Location history table (enhanced from MVP)
CREATE TABLE IF NOT EXISTS location_history (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  family_id UUID REFERENCES families(id) ON DELETE CASCADE NOT NULL,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  speed DOUBLE PRECISION DEFAULT 0,
  accuracy DOUBLE PRECISION DEFAULT 0,
  activity_status TEXT DEFAULT 'stationary',
  battery_level INTEGER,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Safe zones table
CREATE TABLE IF NOT EXISTS safe_zones (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  family_id UUID REFERENCES families(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  radius INTEGER NOT NULL, -- in meters
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  notify_on_entry BOOLEAN DEFAULT true,
  notify_on_exit BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Alerts/notifications table
CREATE TABLE IF NOT EXISTS alerts (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  family_id UUID REFERENCES families(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  type TEXT NOT NULL, -- 'zone_entry', 'zone_exit', 'sos', 'low_battery', 'driving', etc.
  title TEXT NOT NULL,
  message TEXT,
  data JSONB,
  read BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Emergency contacts table
CREATE TABLE IF NOT EXISTS emergency_contacts (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  relationship TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Emergency sessions table (for camera/audio)
CREATE TABLE IF NOT EXISTS emergency_sessions (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  family_id UUID REFERENCES families(id) ON DELETE CASCADE NOT NULL,
  requester_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  target_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  session_type TEXT NOT NULL CHECK (session_type IN ('camera', 'audio', 'sos')),
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'expired', 'active', 'ended')),
  expires_at TIMESTAMP WITH TIME ZONE,
  approved_at TIMESTAMP WITH TIME ZONE,
  ended_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Tracks whether a user is currently inside a safe zone, so entry/exit
-- transitions can be detected rather than firing an alert on every ping.
CREATE TABLE IF NOT EXISTS safe_zone_states (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  zone_id UUID REFERENCES safe_zones(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  is_inside BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(zone_id, user_id)
);

-- ---------------------------------------------------------------------------
-- Migrations for databases created by an earlier version of this schema.
-- CREATE TABLE IF NOT EXISTS above will not alter pre-existing tables, so
-- these blocks bring older databases in line with the definitions above.
-- All are idempotent and safe to re-run.
-- ---------------------------------------------------------------------------

-- Add notification-preference columns to profiles if missing
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS notify_sos BOOLEAN DEFAULT true;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS notify_safe_zones BOOLEAN DEFAULT true;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS notify_low_battery BOOLEAN DEFAULT true;

-- Email is not guaranteed by every auth provider (phone / some OAuth flows),
-- and a NOT NULL violation here would leave the account with no profile row.
-- UNIQUE still applies; Postgres permits multiple NULLs.
ALTER TABLE profiles ALTER COLUMN email DROP NOT NULL;

-- Repoint user-referencing foreign keys from auth.users to profiles so that
-- PostgREST can embed profile rows (e.g. select(*, profiles(name, avatar_url))).
DO $$
BEGIN
  -- Backfill any missing profile rows first, otherwise the new FKs would fail.
  INSERT INTO profiles (id, email, name)
  SELECT u.id,
         u.email,
         COALESCE(u.raw_user_meta_data->>'name', split_part(u.email, '@', 1))
  FROM auth.users u
  LEFT JOIN profiles p ON p.id = u.id
  WHERE p.id IS NULL
  ON CONFLICT (id) DO NOTHING;

  -- family_members.user_id -> profiles(id)
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'family_members_user_id_fkey'
      AND table_name = 'family_members'
  ) THEN
    ALTER TABLE family_members DROP CONSTRAINT family_members_user_id_fkey;
  END IF;
  ALTER TABLE family_members
    ADD CONSTRAINT family_members_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;

  -- location_history.user_id -> profiles(id)
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'location_history_user_id_fkey'
      AND table_name = 'location_history'
  ) THEN
    ALTER TABLE location_history DROP CONSTRAINT location_history_user_id_fkey;
  END IF;
  ALTER TABLE location_history
    ADD CONSTRAINT location_history_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;

  -- alerts.user_id -> profiles(id)
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'alerts_user_id_fkey'
      AND table_name = 'alerts'
  ) THEN
    ALTER TABLE alerts DROP CONSTRAINT alerts_user_id_fkey;
  END IF;
  ALTER TABLE alerts
    ADD CONSTRAINT alerts_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;

  -- emergency_sessions.requester_id / target_id -> profiles(id)
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'emergency_sessions_requester_id_fkey'
      AND table_name = 'emergency_sessions'
  ) THEN
    ALTER TABLE emergency_sessions DROP CONSTRAINT emergency_sessions_requester_id_fkey;
  END IF;
  ALTER TABLE emergency_sessions
    ADD CONSTRAINT emergency_sessions_requester_id_fkey
    FOREIGN KEY (requester_id) REFERENCES profiles(id) ON DELETE CASCADE;

  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'emergency_sessions_target_id_fkey'
      AND table_name = 'emergency_sessions'
  ) THEN
    ALTER TABLE emergency_sessions DROP CONSTRAINT emergency_sessions_target_id_fkey;
  END IF;
  ALTER TABLE emergency_sessions
    ADD CONSTRAINT emergency_sessions_target_id_fkey
    FOREIGN KEY (target_id) REFERENCES profiles(id) ON DELETE CASCADE;
END $$;

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_family_members_family_id ON family_members(family_id);
CREATE INDEX IF NOT EXISTS idx_family_members_user_id ON family_members(user_id);
CREATE INDEX IF NOT EXISTS idx_location_history_user_id ON location_history(user_id);
CREATE INDEX IF NOT EXISTS idx_location_history_family_id ON location_history(family_id);
CREATE INDEX IF NOT EXISTS idx_location_history_created_at ON location_history(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_safe_zones_family_id ON safe_zones(family_id);
CREATE INDEX IF NOT EXISTS idx_alerts_family_id ON alerts(family_id);
CREATE INDEX IF NOT EXISTS idx_alerts_created_at ON alerts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_safe_zone_states_user_id ON safe_zone_states(user_id);
CREATE INDEX IF NOT EXISTS idx_emergency_sessions_target_id ON emergency_sessions(target_id);
CREATE INDEX IF NOT EXISTS idx_emergency_sessions_status ON emergency_sessions(status);

-- Enable Realtime (safe to re-run)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'location_history'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE location_history;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'alerts'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE alerts;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'emergency_sessions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE emergency_sessions;
  END IF;
END $$;

-- Row Level Security
ALTER TABLE families ENABLE ROW LEVEL SECURITY;
ALTER TABLE family_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE location_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE safe_zones ENABLE ROW LEVEL SECURITY;
ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE emergency_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE emergency_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE safe_zone_states ENABLE ROW LEVEL SECURITY;

-- RLS Policies (dropped first so this script is safe to re-run)

-- Profiles: Users can read/update their own profile
DROP POLICY IF EXISTS "Users can view own profile" ON profiles;
CREATE POLICY "Users can view own profile" ON profiles
  FOR SELECT USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
CREATE POLICY "Users can update own profile" ON profiles
  FOR UPDATE USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can insert own profile" ON profiles;
CREATE POLICY "Users can insert own profile" ON profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

-- Families: Any authenticated user can look up a family (needed so
-- INSERT ... RETURNING works when creating a family before the creator's
-- family_members row exists, and so "join by code" can find the family
-- before the joiner is a member). This only exposes id/name/code/timestamps
-- on families; member locations, alerts, and safe zones remain scoped by
-- their own family_members-based policies.
DROP POLICY IF EXISTS "Members can view their families" ON families;
DROP POLICY IF EXISTS "Authenticated users can view families" ON families;
CREATE POLICY "Authenticated users can view families" ON families
  FOR SELECT USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Users can create families" ON families;
CREATE POLICY "Users can create families" ON families
  FOR INSERT WITH CHECK (auth.uid() = created_by);

-- Helper functions for family_members RLS (must exist before the policies
-- below reference them; SECURITY DEFINER lets them bypass RLS on
-- family_members so the policies that call them don't recurse into
-- themselves)
CREATE OR REPLACE FUNCTION is_family_member(check_family_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM family_members
    WHERE family_id = check_family_id AND user_id = auth.uid()
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION is_family_admin(check_family_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM family_members
    WHERE family_id = check_family_id AND user_id = auth.uid() AND role = 'admin'
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Family members: Can view members of their families
DROP POLICY IF EXISTS "Members can view family members" ON family_members;
CREATE POLICY "Members can view family members" ON family_members
  FOR SELECT USING (is_family_member(family_id));

DROP POLICY IF EXISTS "Admins can manage family members" ON family_members;
CREATE POLICY "Admins can manage family members" ON family_members
  FOR ALL USING (is_family_admin(family_id));

-- Users can insert themselves as a family member (needed for create/join family flows)
DROP POLICY IF EXISTS "Users can insert themselves as member" ON family_members;
CREATE POLICY "Users can insert themselves as member" ON family_members
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Location history: Family members can view each other's locations
DROP POLICY IF EXISTS "Family members can view locations" ON location_history;
CREATE POLICY "Family members can view locations" ON location_history
  FOR SELECT USING (
    family_id IN (SELECT family_id FROM family_members WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Users can insert own location" ON location_history;
CREATE POLICY "Users can insert own location" ON location_history
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Safe zones: Family members can view and manage
DROP POLICY IF EXISTS "Family members can view safe zones" ON safe_zones;
CREATE POLICY "Family members can view safe zones" ON safe_zones
  FOR SELECT USING (
    family_id IN (SELECT family_id FROM family_members WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Family members can create safe zones" ON safe_zones;
CREATE POLICY "Family members can create safe zones" ON safe_zones
  FOR INSERT WITH CHECK (
    family_id IN (SELECT family_id FROM family_members WHERE user_id = auth.uid())
  );

-- Alerts: Family members can view their alerts
DROP POLICY IF EXISTS "Family members can view alerts" ON alerts;
CREATE POLICY "Family members can view alerts" ON alerts
  FOR SELECT USING (
    family_id IN (SELECT family_id FROM family_members WHERE user_id = auth.uid())
  );

-- Alerts are written by the client as a side-effect of the acting user's own
-- action (a GPS ping, an SOS press, ending a session). WITH CHECK (true) let
-- any authenticated user forge an alert into any family, so it is scoped to
-- the caller's own family and own user_id.
DROP POLICY IF EXISTS "System can create alerts" ON alerts;
DROP POLICY IF EXISTS "Family members can create alerts" ON alerts;
CREATE POLICY "Family members can create alerts" ON alerts
  FOR INSERT WITH CHECK (
    is_family_member(family_id)
    AND auth.uid() = user_id
  );

-- Emergency contacts: Users can manage their own contacts
DROP POLICY IF EXISTS "Users can manage emergency contacts" ON emergency_contacts;
CREATE POLICY "Users can manage emergency contacts" ON emergency_contacts
  FOR ALL USING (auth.uid() = user_id);

-- Emergency sessions: Family members can view and participate
DROP POLICY IF EXISTS "Family members can view emergency sessions" ON emergency_sessions;
CREATE POLICY "Family members can view emergency sessions" ON emergency_sessions
  FOR SELECT USING (
    family_id IN (SELECT family_id FROM family_members WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Family members can create emergency sessions" ON emergency_sessions;
CREATE POLICY "Family members can create emergency sessions" ON emergency_sessions
  FOR INSERT WITH CHECK (
    is_family_member(family_id)
    AND auth.uid() = requester_id
  );

-- Emergency sessions: the target approves/rejects; either party can end it.
-- SOS sessions are broadcast to the whole family, so any family member may
-- acknowledge one. WITH CHECK pins the row to a family the caller belongs to
-- so an UPDATE cannot move a session into another family.
DROP POLICY IF EXISTS "Participants can update emergency sessions" ON emergency_sessions;
CREATE POLICY "Participants can update emergency sessions" ON emergency_sessions
  FOR UPDATE USING (
    auth.uid() = target_id
    OR auth.uid() = requester_id
    OR (session_type = 'sos' AND is_family_member(family_id))
  )
  WITH CHECK (
    is_family_member(family_id)
    AND (
      auth.uid() = target_id
      OR auth.uid() = requester_id
      OR session_type = 'sos'
    )
  );

-- ---------------------------------------------------------------------------
-- Additional policies required for family management, safe-zone management,
-- and marking alerts as read. Without these, those writes fail under RLS.
-- ---------------------------------------------------------------------------

-- Families: admins can rename / transfer / delete
DROP POLICY IF EXISTS "Admins can update their family" ON families;
CREATE POLICY "Admins can update their family" ON families
  FOR UPDATE USING (is_family_admin(id));

DROP POLICY IF EXISTS "Admins can delete their family" ON families;
CREATE POLICY "Admins can delete their family" ON families
  FOR DELETE USING (is_family_admin(id));

-- Family members: a user can always remove themselves (leave family).
-- Admin removal of other members is covered by "Admins can manage family members".
DROP POLICY IF EXISTS "Users can leave their family" ON family_members;
CREATE POLICY "Users can leave their family" ON family_members
  FOR DELETE USING (auth.uid() = user_id);

-- Safe zones: family members can edit and delete zones in their family
DROP POLICY IF EXISTS "Family members can update safe zones" ON safe_zones;
CREATE POLICY "Family members can update safe zones" ON safe_zones
  FOR UPDATE USING (is_family_member(family_id));

DROP POLICY IF EXISTS "Family members can delete safe zones" ON safe_zones;
CREATE POLICY "Family members can delete safe zones" ON safe_zones
  FOR DELETE USING (is_family_member(family_id));

-- Alerts: family members can mark alerts read
DROP POLICY IF EXISTS "Family members can update alerts" ON alerts;
CREATE POLICY "Family members can update alerts" ON alerts
  FOR UPDATE USING (is_family_member(family_id))
  WITH CHECK (is_family_member(family_id));

-- ---------------------------------------------------------------------------
-- Profiles must be readable by family members.
--
-- The only SELECT policy on profiles was `auth.uid() = id`, but the family
-- list, map, and alerts feed all embed profiles(...) for OTHER members. Under
-- RLS those embeds silently returned NULL, which is why other members showed
-- no name, avatar, battery, or sharing indicator. Visibility is limited to
-- users who share a family with the caller.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION shares_family_with(check_user_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1
    FROM family_members me
    JOIN family_members them ON them.family_id = me.family_id
    WHERE me.user_id = auth.uid()
      AND them.user_id = check_user_id
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

DROP POLICY IF EXISTS "Users can view own profile" ON profiles;
DROP POLICY IF EXISTS "Users can view own and family profiles" ON profiles;
CREATE POLICY "Users can view own and family profiles" ON profiles
  FOR SELECT USING (
    auth.uid() = id OR shares_family_with(id)
  );

-- ---------------------------------------------------------------------------
-- Emergency session context.
--
-- An SOS is stored as an emergency_sessions row with session_type = 'sos' and
-- target_id = requester_id (an SOS has no single target — it goes to the whole
-- family). `data` carries the snapshot the family needs to act on: location,
-- battery, activity, connectivity. Acknowledgement is tracked so responders
-- can see that someone is already on it.
-- ---------------------------------------------------------------------------
ALTER TABLE emergency_sessions ADD COLUMN IF NOT EXISTS data JSONB;
ALTER TABLE emergency_sessions
  ADD COLUMN IF NOT EXISTS acknowledged_by UUID REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE emergency_sessions
  ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMP WITH TIME ZONE;

-- 'resolved' distinguishes "the person confirmed they are safe" from a session
-- that merely stopped. Older databases have the narrower CHECK constraint.
DO $$
BEGIN
  ALTER TABLE emergency_sessions DROP CONSTRAINT IF EXISTS emergency_sessions_status_check;
  ALTER TABLE emergency_sessions ADD CONSTRAINT emergency_sessions_status_check
    CHECK (status IN ('pending', 'approved', 'rejected', 'expired', 'active', 'ended', 'resolved'));
END $$;

CREATE INDEX IF NOT EXISTS idx_emergency_sessions_family_status
  ON emergency_sessions(family_id, status);

-- Safe zone states: users own their own geofence state; family can read it
DROP POLICY IF EXISTS "Users can manage own zone state" ON safe_zone_states;
CREATE POLICY "Users can manage own zone state" ON safe_zone_states
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Family members can view zone states" ON safe_zone_states;
CREATE POLICY "Family members can view zone states" ON safe_zone_states
  FOR SELECT USING (
    zone_id IN (SELECT id FROM safe_zones WHERE is_family_member(family_id))
  );

-- Functions

-- Function to generate family code
CREATE OR REPLACE FUNCTION generate_family_code()
RETURNS TEXT AS $$
DECLARE
  new_code TEXT;
  code_exists BOOLEAN;
BEGIN
  LOOP
    new_code := LPAD(FLOOR(RANDOM() * 1000000)::TEXT, 6, '0');
    SELECT EXISTS(SELECT 1 FROM families WHERE code = new_code) INTO code_exists;
    EXIT WHEN NOT code_exists;
  END LOOP;
  RETURN new_code;
END;
$$ LANGUAGE plpgsql;

-- Function to create profile on signup.
--
-- Every user-referencing foreign key points at profiles(id), so a missing
-- profile row breaks joining a family, sending an SOS, and writing locations.
-- An earlier version used ON CONFLICT (id) only, which did NOT cover the
-- UNIQUE(email) constraint: re-signing up with an email still held by an
-- orphaned profile row raised a unique violation that the exception handler
-- swallowed, leaving the account with no profile at all. Both conflict targets
-- are now handled explicitly.
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  -- Release the email if an orphaned profile row is still holding it.
  IF NEW.email IS NOT NULL THEN
    DELETE FROM profiles WHERE email = NEW.email AND id <> NEW.id;
  END IF;

  INSERT INTO profiles (id, email, name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(
      NULLIF(NEW.raw_user_meta_data->>'name', ''),
      NULLIF(split_part(COALESCE(NEW.email, ''), '@', 1), ''),
      'Family member'
    )
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    name = COALESCE(profiles.name, EXCLUDED.name);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to create profile on signup
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- Function to clean up old location history (keep last 7 days)
CREATE OR REPLACE FUNCTION cleanup_old_locations()
RETURNS void AS $$
BEGIN
  DELETE FROM location_history 
  WHERE created_at < NOW() - INTERVAL '7 days';
END;
$$ LANGUAGE plpgsql;
