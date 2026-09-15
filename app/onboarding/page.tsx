"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { ensureProfile } from "@/lib/profile";
import { useAppStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function OnboardingPage() {
  const router = useRouter();
  const setCurrentFamily = useAppStore((state) => state.setCurrentFamily);
  const [mode, setMode] = useState<"choose" | "create" | "join">("choose");
  const [familyName, setFamilyName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [checkingAuth, setCheckingAuth] = useState(true);

  // Guard: redirect to login if there's no active session instead of
  // letting the user submit a form and hit "Not authenticated".
  useEffect(() => {
    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.push("/login");
        return;
      }
      setCheckingAuth(false);
    };
    checkAuth();
  }, [router]);

  if (checkingAuth) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  const handleCreateFamily = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      // family_members.user_id references profiles(id); without this the
      // insert below fails on family_members_user_id_fkey.
      const { profile, error: profileError } = await ensureProfile();
      if (profileError || !profile) {
        throw new Error(
          "Could not set up your profile. Sign out and back in, then try again."
        );
      }

      // Generate a unique 6-digit code
      const code = Math.floor(100000 + Math.random() * 900000).toString();

      // Create family
      const { data: family, error: familyError } = await supabase
        .from("families")
        .insert({
          name: familyName,
          code,
          created_by: user.id,
        })
        .select()
        .single();

      if (familyError) throw familyError;

      // Add creator as admin member
      const { error: memberError } = await supabase
        .from("family_members")
        .insert({
          family_id: family.id,
          user_id: user.id,
          role: "admin",
          name: profile.name || user.email?.split("@")[0] || "Me",
        });

      if (memberError) throw memberError;

      setCurrentFamily(family);
      router.push("/app");
    } catch (err: any) {
      setError(err.message || "Failed to create family");
    } finally {
      setLoading(false);
    }
  };

  const handleJoinFamily = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      // family_members.user_id references profiles(id); without this the
      // insert below fails on family_members_user_id_fkey.
      const { profile, error: profileError } = await ensureProfile();
      if (profileError || !profile) {
        throw new Error(
          "Could not set up your profile. Sign out and back in, then try again."
        );
      }

      // Find family by code
      const { data: family, error: familyError } = await supabase
        .from("families")
        .select("*")
        .eq("code", joinCode)
        .maybeSingle();

      if (familyError) throw familyError;
      if (!family) {
        throw new Error("Invalid family code. Check the code and try again.");
      }

      // Guard against joining the same family twice (UNIQUE constraint would
      // otherwise surface as an opaque duplicate-key error).
      const { data: existing } = await supabase
        .from("family_members")
        .select("id")
        .eq("family_id", family.id)
        .eq("user_id", user.id)
        .maybeSingle();

      if (existing) {
        setCurrentFamily(family);
        router.push("/app");
        return;
      }

      // Add user as member
      const { error: memberError } = await supabase
        .from("family_members")
        .insert({
          family_id: family.id,
          user_id: user.id,
          role: "member",
          name: profile.name || user.email?.split("@")[0] || "Me",
        });

      if (memberError) throw memberError;

      setCurrentFamily(family);
      router.push("/app");
    } catch (err: any) {
      setError(err.message || "Failed to join family");
    } finally {
      setLoading(false);
    }
  };

  if (mode === "choose") {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-primary/5 via-background to-secondary/10">
        <Card className="w-full max-w-md glass-strong">
          <CardHeader className="space-y-3 text-center">
            <div className="mx-auto w-16 h-16 rounded-2xl bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center text-3xl">
              👨‍👩‍👧‍👦
            </div>
            <CardTitle className="text-3xl">Setup Your Family</CardTitle>
            <CardDescription className="text-base">
              Create a new family circle or join an existing one
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-3">
            <Button
              className="w-full"
              size="lg"
              onClick={() => setMode("create")}
            >
              Create New Family
            </Button>

            <Button
              variant="outline"
              className="w-full"
              size="lg"
              onClick={() => setMode("join")}
            >
              Join Existing Family
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (mode === "create") {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-primary/5 via-background to-secondary/10">
        <Card className="w-full max-w-md glass-strong">
          <CardHeader className="space-y-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setMode("choose")}
              className="w-fit"
            >
              ← Back
            </Button>
            <CardTitle className="text-2xl">Create Family</CardTitle>
            <CardDescription>
              Choose a name for your family circle
            </CardDescription>
          </CardHeader>

          <CardContent>
            <form onSubmit={handleCreateFamily} className="space-y-4">
              <div className="space-y-2">
                <Input
                  type="text"
                  placeholder="Family Name (e.g., The Smiths)"
                  value={familyName}
                  onChange={(e) => setFamilyName(e.target.value)}
                  required
                  disabled={loading}
                />
              </div>

              {error && (
                <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
                  {error}
                </div>
              )}

              <Button
                type="submit"
                className="w-full"
                size="lg"
                disabled={loading}
              >
                {loading ? "Creating..." : "Create Family"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-primary/5 via-background to-secondary/10">
      <Card className="w-full max-w-md glass-strong">
        <CardHeader className="space-y-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setMode("choose")}
            className="w-fit"
          >
            ← Back
          </Button>
          <CardTitle className="text-2xl">Join Family</CardTitle>
          <CardDescription>
            Enter the 6-digit code shared by your family
          </CardDescription>
        </CardHeader>

        <CardContent>
          <form onSubmit={handleJoinFamily} className="space-y-4">
            <div className="space-y-2">
              <Input
                type="text"
                placeholder="Enter 6-digit code"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                required
                maxLength={6}
                disabled={loading}
                className="text-center text-2xl tracking-widest"
              />
            </div>

            {error && (
              <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
                {error}
              </div>
            )}

            <Button
              type="submit"
              className="w-full"
              size="lg"
              disabled={loading || joinCode.length !== 6}
            >
              {loading ? "Joining..." : "Join Family"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
