import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase-server';

/**
 * Handles both email-confirmation and OAuth redirects.
 *
 * Uses the cookie-backed server client so the exchanged session actually
 * persists. Routes the user to /onboarding when they have no family yet,
 * otherwise into the app.
 */
export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get('code');
  const errorDescription = requestUrl.searchParams.get('error_description');

  // Supabase reports link problems (expired/already-used) via query params.
  if (errorDescription) {
    return NextResponse.redirect(
      new URL(`/login?error=${encodeURIComponent(errorDescription)}`, requestUrl.origin)
    );
  }

  if (!code) {
    return NextResponse.redirect(new URL('/login', requestUrl.origin));
  }

  const supabase = createSupabaseServerClient();

  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
  if (exchangeError) {
    return NextResponse.redirect(
      new URL(`/login?error=${encodeURIComponent(exchangeError.message)}`, requestUrl.origin)
    );
  }

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(new URL('/login', requestUrl.origin));
  }

  // maybeSingle(): a user with no family returns zero rows, which .single()
  // would surface as a PGRST116 error instead of null.
  const { data: familyMember } = await supabase
    .from('family_members')
    .select('family_id')
    .eq('user_id', user.id)
    .maybeSingle();

  return NextResponse.redirect(
    new URL(familyMember ? '/app' : '/onboarding', requestUrl.origin)
  );
}
