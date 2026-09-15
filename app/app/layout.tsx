"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { supabase, signOut } from "@/lib/supabase";
import { ensureProfile } from "@/lib/profile";
import { useAppStore } from "@/lib/store";
import { MapPin, Users, Shield, Bell, Settings } from "lucide-react";
import { cn } from "@/lib/utils";
import OfflineBanner from "@/components/OfflineBanner";
import SosBanner from "@/components/SosBanner";
import { LocationSharingProvider } from "@/lib/locationSharing";

const navItems = [
  { icon: MapPin, label: "Map", href: "/app" },
  { icon: Users, label: "Family", href: "/app/family" },
  { icon: Shield, label: "Safety", href: "/app/safety" },
  { icon: Bell, label: "Alerts", href: "/app/alerts" },
  { icon: Settings, label: "Settings", href: "/app/settings" },
];

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [loading, setLoading] = useState(true);
  const [fatal, setFatal] = useState<string | null>(null);
  const { setUser, setCurrentFamily, reset } = useAppStore();

  useEffect(() => {
    const initializeApp = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();

        if (!session) {
          router.push("/login");
          return;
        }

        // Load the profile, creating it if the signup trigger never did.
        // Without a profile row, every write keyed to profiles(id) — SOS
        // alerts, location updates, family membership — fails on a foreign
        // key constraint, so this must resolve before rendering the app.
        const { profile, error: profileError } = await ensureProfile();

        if (profileError || !profile) {
          setFatal(
            "We could not load your profile. Please sign out and sign in again."
          );
          setLoading(false);
          return;
        }

        setUser(profile);

        // Load family. maybeSingle() because a user with no family yet returns
        // zero rows, which .single() reports as a PGRST116 error.
        const { data: familyMember } = await supabase
          .from("family_members")
          .select("family_id, families(*)")
          .eq("user_id", session.user.id)
          .maybeSingle();

        if (familyMember && familyMember.families) {
          setCurrentFamily(familyMember.families as any);
        } else {
          router.push("/onboarding");
          return;
        }

        setLoading(false);
      } catch (error) {
        console.error("Error initializing app:", error);
        router.push("/login");
      }
    };

    initializeApp();
  }, [router, setUser, setCurrentFamily]);

  // Surface setup failures instead of rendering an app whose every write will
  // fail on a foreign key it cannot satisfy.
  if (fatal) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="max-w-sm space-y-4 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-destructive/10 text-2xl">
            ⚠️
          </div>
          <p className="font-medium">Something needs attention</p>
          <p className="text-sm text-muted-foreground">{fatal}</p>
          <button
            type="button"
            onClick={async () => {
              await signOut();
              reset();
              router.push("/login");
            }}
            className="w-full rounded-lg bg-primary px-5 py-2.5 font-medium text-primary-foreground"
          >
            Sign out
          </button>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center text-3xl animate-pulse">
            🛡️
          </div>
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    /*
      The geolocation watch lives in this provider rather than in the Map page
      so that it survives tab navigation and there is exactly one watcher for
      the whole session. Start/Stop is therefore reachable from anywhere.
    */
    <LocationSharingProvider>
    <div className="flex flex-col h-screen bg-background">
      <OfflineBanner />
      <SosBanner />

      {/*
        overflow-hidden, not overflow-y-auto: each screen owns its own scroll
        container so PullToRefresh can detect scrollTop === 0. A scrolling
        parent would swallow that.
      */}
      <main className="flex-1 overflow-hidden pb-20">
        {children}
      </main>

      {/* Bottom navigation */}
      <nav className="fixed bottom-0 left-0 right-0 h-20 glass-strong border-t safe-bottom z-50">
        <div className="flex items-center justify-around h-full px-2">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href;

            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex flex-col items-center justify-center gap-1 px-4 py-2 rounded-xl transition-all",
                  isActive
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Icon
                  className={cn(
                    "w-6 h-6 transition-transform",
                    isActive && "scale-110"
                  )}
                />
                <span className="text-xs font-medium">{item.label}</span>
                {isActive && (
                  <div className="absolute bottom-0 w-1 h-1 rounded-full bg-primary" />
                )}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
    </LocationSharingProvider>
  );
}
