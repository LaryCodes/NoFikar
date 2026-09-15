# Bugfix Requirements Document

## Introduction

Creating a family from `/onboarding` fails with the Postgres error `infinite recursion detected in policy for relation "family_members"`. The root cause is that the RLS policies `"Members can view family members"` and `"Admins can manage family members"` on `family_members` (in `supabase/schema.sql`) each query `family_members` inside their own `USING` clause. Because the inner `SELECT` against `family_members` re-triggers the very same RLS policy, Postgres recurses until it errors out. This blocks the create-family and join-family flows entirely, since both insert into `family_members` and any subsequent read of that table re-evaluates the recursive policies.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN a client inserts a row into `family_members` (create-family or join-family flow) THEN the system fails the request with `infinite recursion detected in policy for relation "family_members"` instead of completing the insert
1.2 WHEN a client performs a `SELECT` against `family_members` under RLS THEN the system recurses infinitely while evaluating the `"Members can view family members"` policy, because its `USING` clause subquery re-queries `family_members` and re-triggers the same policy
1.3 WHEN a client with `role = 'admin'` performs any operation on `family_members` THEN the system recurses infinitely while evaluating the `"Admins can manage family members"` policy, for the same self-referencing reason

### Expected Behavior (Correct)

2.1 WHEN a client inserts a row into `family_members` (create-family or join-family flow) THEN the system SHALL complete the insert without any infinite recursion error
2.2 WHEN a client performs a `SELECT` against `family_members` under RLS THEN the system SHALL determine membership using a `SECURITY DEFINER` helper function (e.g. `is_family_member(family_id)`) that queries `family_members` internally while bypassing RLS, instead of re-entering the same policy
2.3 WHEN a client performs an admin-only operation on `family_members` THEN the system SHALL determine admin status using a `SECURITY DEFINER` helper function (e.g. `is_family_admin(family_id)`) that bypasses RLS internally, instead of re-entering the same policy

### Unchanged Behavior (Regression Prevention)

3.1 WHEN a user queries `families` they belong to THEN the system SHALL CONTINUE TO return only families where they are a member
3.2 WHEN a non-admin user attempts to insert, update, or delete another user's `family_members` row THEN the system SHALL CONTINUE TO deny the operation
3.3 WHEN a user inserts themselves as a new `family_members` row (create-family or join-family flow) THEN the system SHALL CONTINUE TO allow the insert
3.4 WHEN policies on other tables (`safe_zones`, `alerts`, `location_history`, `emergency_sessions`) check family membership via `family_id IN (SELECT family_id FROM family_members WHERE user_id = auth.uid())` THEN the system SHALL CONTINUE TO enforce the same family-scoped access rules, whether they keep the inline subquery or are switched to the new helper function
3.5 WHEN the `handle_new_user` trigger creates a `profiles` row on signup THEN the system SHALL CONTINUE TO behave exactly as before (unaffected by this fix)

## Bug Condition

```pascal
FUNCTION isBugCondition(X)
  INPUT: X of type DatabaseOperation
  OUTPUT: boolean

  // Any RLS-governed operation against family_members triggers the
  // self-referencing policy evaluation, regardless of the specific
  // row values involved.
  RETURN X.targetTable = 'family_members' AND X.executedUnderRLS = true
END FUNCTION
```

```pascal
// Property: Fix Checking - No Recursion on family_members
FOR ALL X WHERE isBugCondition(X) DO
  result <- F'(X)
  ASSERT result.error != "infinite recursion detected in policy for relation \"family_members\""
     AND result.completedSuccessfully = true
END FOR
```

```pascal
// Property: Preservation Checking - Access Rules Unchanged
FOR ALL X WHERE NOT isBugCondition(X) DO
  ASSERT F(X) = F'(X)
END FOR
```
