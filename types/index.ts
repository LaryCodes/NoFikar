export interface LocationData {
  id?: string;
  child_id: string;
  latitude: number;
  longitude: number;
  speed: number;
  accuracy: number;
  activity_status: string;
  created_at?: string;
}

export interface ActivityStatus {
  icon: string;
  label: string;
  color: string;
}
