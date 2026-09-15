"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useTheme } from "next-themes";
import { supabase, signOut } from "@/lib/supabase";
import { useAppStore } from "@/lib/store";
import { useLocationSharing } from "@/lib/locationSharing";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  User,
  Shield,
  Moon,
  Sun,
  Monitor,
  LogOut,
  ChevronRight,
  Info,
  FileText,
  Users,
  Loader2,
  AlertCircle,
  Check,
} from "lucide-react";

const THEME_OPTIONS = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
] as const;

export default function SettingsPage() {
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const { user, currentFamily, setUser, reset } = useAppStore();
  // Same provider the Map tab drives, so this switch reflects (and controls)
  // the real GPS watcher instead of a second, disagreeing flag.
  const {
    sharing,
    starting,
    stop: stopSharing,
    start: startSharing,
  } = useLocationSharing();

  const [mounted, setMounted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [profileOpen, setProfileOpen] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);

  const [prefs, setPrefs] = useState({
    notify_sos: true,
    notify_safe_zones: true,
    notify_low_battery: true,
  });
  const [savingPref, setSavingPref] = useState<string | null>(null);
  const [togglingSharing, setTogglingSharing] = useState(false);

  // next-themes resolves on the client only; rendering the active state before
  // mount causes a hydration mismatch.
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!user) return;
    setNameDraft(user.name ?? "");
    setPrefs({
      notify_sos: user.notify_sos ?? true,
      notify_safe_zones: user.notify_safe_zones ?? true,
      notify_low_battery: user.notify_low_battery ?? true,
    });
  }, [user]);

  useEffect(() => {
    if (!saved) return;
    const t = setTimeout(() => setSaved(false), 2500);
    return () => clearTimeout(t);
  }, [saved]);

  const saveName = async () => {
    if (!user) return;
    const next = nameDraft.trim();
    if (!next) {
      setError("Name cannot be empty.");
      return;
    }

    setSavingProfile(true);
    setError(null);
    try {
      const { error: err } = await supabase
        .from("profiles")
        .update({ name: next, updated_at: new Date().toISOString() })
        .eq("id", user.id);
      if (err) throw err;

      // Keep the denormalised copy on family_members in step so the family
      // list does not show a stale name.
      await supabase
        .from("family_members")
        .update({ name: next })
        .eq("user_id", user.id);

      setUser({ ...user, name: next });
      setProfileOpen(false);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save your name.");
    } finally {
      setSavingProfile(false);
    }
  };

  const updatePref = async (key: keyof typeof prefs, value: boolean) => {
    if (!user) return;

    const previous = prefs[key];
    setPrefs((p) => ({ ...p, [key]: value })); // optimistic
    setSavingPref(key);
    setError(null);

    try {
      const { error: err } = await supabase
        .from("profiles")
        .update({ [key]: value, updated_at: new Date().toISOString() })
        .eq("id", user.id);
      if (err) throw err;

      setUser({ ...user, [key]: value });
      setSaved(true);
    } catch (err) {
      setPrefs((p) => ({ ...p, [key]: previous })); // roll back
      setError(err instanceof Error ? err.message : "Could not save preference.");
    } finally {
      setSavingPref(null);
    }
  };

  const toggleSharing = async (next: boolean) => {
    setError(null);
    setTogglingSharing(true);
    try {
      if (next) startSharing();
      else await stopSharing();
    } finally {
      setTogglingSharing(false);
    }
  };

  const handleSignOut = async () => {
    // Stop the GPS watch and clear the stored flag first, otherwise the family
    // would keep seeing this account as sharing after it signed out.
    if (sharing) await stopSharing();
    await signOut();
    reset();
    router.push("/login");
  };

  const displayName = user?.name || user?.email?.split("@")[0] || "You";

  return (
    <div className="safe-top h-full space-y-6 overflow-y-auto p-4">
      <header>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Profile, notifications, and privacy
        </p>
      </header>

      {error && (
        <Card className="border-destructive/30 bg-destructive/10 p-3">
          <div className="flex gap-2">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <p className="text-sm text-destructive">{error}</p>
          </div>
        </Card>
      )}

      {saved && (
        <Card className="border-primary/30 bg-primary/10 p-3">
          <div className="flex items-center gap-2">
            <Check className="h-4 w-4 text-primary" />
            <p className="text-sm text-primary">Saved</p>
          </div>
        </Card>
      )}

      {/* Profile */}
      <Card className="p-4">
        {!user ? (
          <div className="flex items-center gap-3">
            <Skeleton className="h-16 w-16 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </div>
        ) : (
          <>
            <div className="mb-4 flex items-center gap-3">
              <span className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary/15 text-2xl font-semibold">
                {user.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={user.avatar_url}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                ) : (
                  displayName.slice(0, 1).toUpperCase()
                )}
              </span>
              <div className="min-w-0">
                <h2 className="truncate font-semibold">{displayName}</h2>
                <p className="truncate text-sm text-muted-foreground">
                  {user.email}
                </p>
              </div>
            </div>

            <Button
              variant="outline"
              className="w-full justify-between"
              onClick={() => setProfileOpen(true)}
            >
              <span className="flex items-center gap-2">
                <User className="h-4 w-4" />
                Edit profile
              </span>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </>
        )}
      </Card>

      {/* Family */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Family
        </h2>
        <Card>
          <Link
            href="/app/family"
            className="flex items-center justify-between p-4 transition-colors hover:bg-accent/50"
          >
            <span className="flex items-center gap-3">
              <Users className="h-5 w-5 text-muted-foreground" />
              <span>
                <span className="block font-medium">
                  {currentFamily?.name ?? "No family"}
                </span>
                {currentFamily?.code && (
                  <span className="block text-sm text-muted-foreground">
                    Invite code {currentFamily.code}
                  </span>
                )}
              </span>
            </span>
            <ChevronRight className="h-5 w-5 text-muted-foreground" />
          </Link>
        </Card>
      </section>

      {/* Privacy */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Privacy
        </h2>
        <Card className="divide-y">
          <div className="flex items-start justify-between gap-4 p-4">
            <div className="min-w-0">
              <Label htmlFor="pref-sharing" className="font-medium">
                Share my location
              </Label>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {sharing
                  ? "Live location sharing is on. Your family can see where you are."
                  : "Off — your family cannot see where you are. Turning this on starts a live GPS session on this device."}
              </p>
            </div>
            <div className="flex h-6 shrink-0 items-center">
              {togglingSharing || starting ? (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              ) : (
                <Switch
                  id="pref-sharing"
                  checked={sharing}
                  onCheckedChange={toggleSharing}
                  disabled={!user}
                />
              )}
            </div>
          </div>
        </Card>
      </section>

      {/* Notifications */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Notifications
        </h2>
        <Card className="divide-y">
          {(
            [
              {
                key: "notify_sos" as const,
                label: "Emergency SOS",
                hint: "Always recommended.",
              },
              {
                key: "notify_safe_zones" as const,
                label: "Safe zone arrivals & departures",
                hint: "Alerts when family members reach or leave a zone.",
              },
              {
                key: "notify_low_battery" as const,
                label: "Low battery",
                hint: "When a family member drops below 20%.",
              },
            ]
          ).map(({ key, label, hint }) => (
            <div key={key} className="flex items-start justify-between gap-4 p-4">
              <div className="min-w-0">
                <Label htmlFor={`pref-${key}`} className="font-medium">
                  {label}
                </Label>
                <p className="mt-0.5 text-sm text-muted-foreground">{hint}</p>
              </div>
              <div className="flex h-6 shrink-0 items-center">
                {savingPref === key ? (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                ) : (
                  <Switch
                    id={`pref-${key}`}
                    checked={prefs[key]}
                    onCheckedChange={(v) => updatePref(key, v)}
                    disabled={!user}
                  />
                )}
              </div>
            </div>
          ))}
        </Card>
      </section>

      {/* Appearance */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Appearance
        </h2>
        <Card className="p-4">
          <Label className="mb-3 block font-medium">Theme</Label>
          <div className="grid grid-cols-3 gap-2">
            {THEME_OPTIONS.map(({ value, label, icon: Icon }) => {
              const active = mounted && theme === value;
              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setTheme(value)}
                  className={`rounded-xl border-2 p-3 transition-all ${
                    active
                      ? "border-primary bg-primary/10"
                      : "border-border hover:border-primary/50"
                  }`}
                >
                  <Icon
                    className={`mx-auto mb-1 h-5 w-5 ${
                      active ? "text-primary" : "text-muted-foreground"
                    }`}
                  />
                  <span className="block text-xs font-medium">{label}</span>
                </button>
              );
            })}
          </div>
        </Card>
      </section>

      {/* Legal */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Legal
        </h2>
        <Card className="divide-y">
          {[
            { href: "/legal/terms", label: "Terms of Service", icon: FileText },
            { href: "/legal/privacy", label: "Privacy Policy", icon: FileText },
            { href: "/legal/safety", label: "Safety Guidelines", icon: Shield },
          ].map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className="flex items-center justify-between p-4 transition-colors hover:bg-accent/50"
            >
              <span className="flex items-center gap-3">
                <Icon className="h-5 w-5 text-muted-foreground" />
                <span className="font-medium">{label}</span>
              </span>
              <ChevronRight className="h-5 w-5 text-muted-foreground" />
            </Link>
          ))}
        </Card>
      </section>

      <Card className="p-4">
        <p className="flex items-center gap-3 text-sm text-muted-foreground">
          <Info className="h-4 w-4" />
          NoFikar v2.0.0
        </p>
      </Card>

      <Button
        variant="destructive"
        className="w-full gap-2"
        size="lg"
        onClick={handleSignOut}
      >
        <LogOut className="h-5 w-5" />
        Sign out
      </Button>

      <div className="h-4" />

      {/* Edit profile */}
      <Dialog open={profileOpen} onOpenChange={setProfileOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit profile</DialogTitle>
            <DialogDescription>
              This is the name your family sees.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="profile-name">Display name</Label>
              <Input
                id="profile-name"
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                disabled={savingProfile}
                maxLength={60}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="profile-email">Email</Label>
              <Input
                id="profile-email"
                value={user?.email ?? ""}
                readOnly
                disabled
              />
              <p className="text-xs text-muted-foreground">
                Email changes are not supported yet.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setProfileOpen(false)}
              disabled={savingProfile}
            >
              Cancel
            </Button>
            <Button onClick={saveName} disabled={savingProfile} className="gap-2">
              {savingProfile && <Loader2 className="h-4 w-4 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
