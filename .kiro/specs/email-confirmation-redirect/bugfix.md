# Bugfix Requirements Document

## Introduction

After signing up with email/password on `/signup`, the confirmation email sent by Supabase links to a stale/placeholder Vercel URL and 404s, instead of pointing at the running app (`http://localhost:3000` in local dev, or the correct deployed origin in production). This is primarily a Supabase Auth "URL Configuration" (Site URL / Redirect URLs) mismatch, but the signup and callback code paths also need to correctly handle both the "session already confirmed" and "pending email confirmation" states so the flow is coherent once the link resolves to the right origin.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN a user signs up with email/password and Supabase's project Site URL is set to a stale/placeholder Vercel URL THEN the system sends a confirmation email whose link points at that stale URL and 404s when clicked, regardless of where the app is actually running
1.2 WHEN the Supabase project's Redirect URLs allow-list does not include `http://localhost:3000/**` THEN the system rejects or mis-routes the confirmation redirect during local development
1.3 WHEN there is no documentation describing the required Supabase Auth URL Configuration THEN developers have no way to know the Site URL and Redirect URLs must be updated to match their running environment

### Expected Behavior (Correct)

2.1 WHEN a user signs up with email/password in local development THEN the system SHALL send a confirmation email whose link resolves to `http://localhost:3000/auth/callback` (via correct Supabase Site URL / Redirect URLs configuration) rather than a stale placeholder domain
2.2 WHEN the Supabase project's Redirect URLs allow-list is configured THEN it SHALL include `http://localhost:3000/**` (and the equivalent production origin) so confirmation and OAuth redirects are accepted in both environments
2.3 WHEN a developer sets up the project THEN the system SHALL provide documentation stating the exact Supabase Auth URL Configuration required (Site URL = app origin, Redirect URLs including `<origin>/**`) so confirmation links work in local dev and production
2.4 WHEN the confirmation link is clicked and resolves to `/auth/callback` with a valid `code` THEN the system SHALL exchange the code for a session and route the user to `/onboarding` (no family yet) or `/app` (family already exists), matching the existing callback logic

### Unchanged Behavior (Regression Prevention)

3.1 WHEN a user signs up and Supabase returns a session immediately (email confirmation disabled) THEN the system SHALL CONTINUE TO redirect the user straight to `/onboarding`
3.2 WHEN a user signs up and Supabase returns a user but no session (email confirmation required) THEN the system SHALL CONTINUE TO show the "Check your email" screen instead of redirecting into the app
3.3 WHEN a user signs in with Google OAuth THEN the system SHALL CONTINUE TO redirect through `/auth/callback` and land on `/onboarding` or `/app` exactly as it does today
3.4 WHEN `/auth/callback` receives no `code` parameter THEN the system SHALL CONTINUE TO fall through to checking the current user/session and redirecting accordingly, without erroring

## Bug Condition

```pascal
FUNCTION isBugCondition(X)
  INPUT: X of type AuthConfigState
  OUTPUT: boolean

  // The bug is triggered whenever the Supabase project's Site URL /
  // Redirect URLs configuration does not match the app's actual
  // running origin (local dev or production), independent of the
  // signup form inputs themselves.
  RETURN X.supabaseSiteUrl != X.appRunningOrigin
      OR NOT X.supabaseRedirectUrls.includes(X.appRunningOrigin + "/**")
END FUNCTION
```

```pascal
// Property: Fix Checking - Confirmation Link Resolves Correctly
FOR ALL X WHERE isBugCondition(X) DO
  result <- F'(X)
  ASSERT result.confirmationLinkOrigin = X.appRunningOrigin
     AND result.linkResolves = true
     AND result.documentationStatesRequiredConfig = true
END FOR
```

```pascal
// Property: Preservation Checking - Signup/Callback Logic Unchanged
FOR ALL X WHERE NOT isBugCondition(X) DO
  ASSERT F(X) = F'(X)
END FOR
```
