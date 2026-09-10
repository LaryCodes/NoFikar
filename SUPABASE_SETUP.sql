-- SafeTrack Database Setup
-- Run this in your Supabase SQL Editor

-- Create the main location tracking table
CREATE TABLE IF NOT EXISTS child_locations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  child_id TEXT NOT NULL,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  speed DOUBLE PRECISION DEFAULT 0,
  accuracy DOUBLE PRECISION DEFAULT 0,
  activity_status TEXT DEFAULT 'Stationary',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable Realtime for live updates (CRITICAL!)
ALTER PUBLICATION supabase_realtime ADD TABLE child_locations;

-- Add indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_child_locations_child_id 
  ON child_locations(child_id);

CREATE INDEX IF NOT EXISTS idx_child_locations_created_at 
  ON child_locations(created_at DESC);

-- Enable Row Level Security
ALTER TABLE child_locations ENABLE ROW LEVEL SECURITY;

-- Allow all users to read locations (for MVP demo)
CREATE POLICY "Enable read access for all users" 
  ON child_locations FOR SELECT 
  USING (true);

-- Allow all users to insert locations (for MVP demo)
CREATE POLICY "Enable insert access for all users" 
  ON child_locations FOR INSERT 
  WITH CHECK (true);

-- Optional: Function to clean up old locations
CREATE OR REPLACE FUNCTION cleanup_old_locations()
RETURNS void AS $$
BEGIN
  DELETE FROM child_locations 
  WHERE created_at < NOW() - INTERVAL '24 hours';
END;
$$ LANGUAGE plpgsql;

-- Optional: View for latest location per child
CREATE OR REPLACE VIEW latest_child_locations AS
SELECT DISTINCT ON (child_id)
  id,
  child_id,
  latitude,
  longitude,
  speed,
  accuracy,
  activity_status,
  created_at
FROM child_locations
ORDER BY child_id, created_at DESC;

-- Success message
DO $$
BEGIN
  RAISE NOTICE 'SafeTrack database setup completed successfully!';
  RAISE NOTICE 'Table: child_locations created';
  RAISE NOTICE 'Realtime: Enabled';
  RAISE NOTICE 'Indexes: Created';
  RAISE NOTICE 'RLS Policies: Enabled';
END $$;
