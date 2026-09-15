"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [done, setDone] = useState(false);

  // Supabase puts the user in a temporary recovery session when they land here
  // from the emailed link. Without that session there is nothing to update.
  useEffect(() => {
    const check = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setError(
          "This reset link is invalid or has expired. Request a new one."
        );
      }
      setReady(true);
    };
    check();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setDone(true);
      setTimeout(() => router.push("/app"), 1500);
    } catch (err: any) {
      setError(err.message || "Could not update password.");
    } finally {
      setLoading(false);
    }
  };

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-primary/5 via-background to-secondary/10">
      <Card className="w-full max-w-md glass-strong">
        <CardHeader className="space-y-3 text-center">
          <div className="mx-auto w-16 h-16 rounded-2xl bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center text-3xl">
            {done ? "✅" : "🔒"}
          </div>
          <CardTitle className="text-2xl">
            {done ? "Password updated" : "Choose a new password"}
          </CardTitle>
          <CardDescription className="text-base">
            {done
              ? "Signing you in..."
              : "Enter a new password for your account."}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {!done && (
            <form onSubmit={handleSubmit} className="space-y-4">
              <Input
                type="password"
                placeholder="New password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                disabled={loading}
                autoComplete="new-password"
              />
              <Input
                type="password"
                placeholder="Confirm new password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                minLength={6}
                disabled={loading}
                autoComplete="new-password"
              />

              {error && (
                <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
                  {error}
                </div>
              )}

              <Button type="submit" className="w-full" size="lg" disabled={loading}>
                {loading ? "Updating..." : "Update password"}
              </Button>
            </form>
          )}

          {!done && (
            <Link href="/forgot-password" className="block">
              <Button variant="ghost" className="w-full">
                Request a new link
              </Button>
            </Link>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
