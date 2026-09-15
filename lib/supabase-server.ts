import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';

/**
 * Supabase client for use in Route Handlers and Server Components.
 *
 * The browser client in `lib/supabase.ts` keeps its session in localStorage,
 * which is not available on the server. Auth code exchange (email confirmation
 * links, OAuth callbacks) has to run through this cookie-backed client so the
 * resulting session is actually persisted for subsequent requests.
 */
export function createSupabaseServerClient() {
  const cookieStore = cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          try {
            cookieStore.set({ name, value, ...options });
          } catch {
            // Called from a Server Component, which cannot mutate cookies.
            // Safe to ignore: middleware/route handlers refresh the session.
          }
        },
        remove(name: string, options: CookieOptions) {
          try {
            cookieStore.set({ name, value: '', ...options });
          } catch {
            // See note above.
          }
        },
      },
    }
  );
}
