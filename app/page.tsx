"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      
      if (session) {
        // Check if user has a family
        const { data: familyMember } = await supabase
          .from("family_members")
          .select("family_id")
          .eq("user_id", session.user.id)
          .maybeSingle();

        if (familyMember) {
          router.push("/app");
        } else {
          router.push("/onboarding");
        }
      } else {
        router.push("/login");
      }
    };

    checkAuth();
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center space-y-4">
        <div className="w-20 h-20 mx-auto rounded-2xl bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center text-4xl">
          🛡️
        </div>
        <h1 className="text-3xl font-bold">NoFikar</h1>
        <p className="text-muted-foreground">Less worry. More freedom.</p>
      </div>
    </div>
  );
}
