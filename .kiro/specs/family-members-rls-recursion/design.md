# Family Members RLS Recursion Bugfix Design

## Overview

Creating or joining a family fails because two RLS policies on `family_members`
("Members can view family members" and "Admins can manage family members")
query `family_members` from within their own `USING` clause. Postgres
re-evaluates the same RLS policy for that inner subquery, which re-enters the
outer policy, and so on, until Postgres aborts with `infinite recursion
detected in policy for relation "family_members"`.

The fix introduces two `SECURITY DEFINER STABLE` helper functions,
`is_family_member(check_family_id UUID)` and `is_family_admin(check_family_id
UUID)`. Each performs an `EXISTS` check against `family_members` scoped to
`auth.uid()`. Because the functions are `SECURITY DEFINER`, the internal query
runs with the privileges of the function owner and bypasses RLS on
`family_members`, so it does not re-trigger the calling policy. The two
affected policies are rewritten to call these helper functions instead of the
self-referencing inline subqueries. The "Users can insert themselves as
member" policy is untouched because its `WITH CHECK (auth.uid() = user_id)`
clause never queries `family_members` and is not part of the recursion. All
other tables' policies (`families`, `safe_zones`, `alerts`, `location_history`,
`emergency_sessions`) keep their existing inline
`family_id IN (SELECT family_id FROM family_members WHERE user_id = auth.uid())`
subqueries unchanged, since those subqueries run under the RLS of the table
being queried (not `family_members`'s own policy), so they are not
self-referencing and are out of scope for this fix.

## Glossary

- **Bug_Condition (C)**: Any database operation executed under RLS whose
  target table is `family_members` — this is what triggers the recursive
  policy evaluation, regardless of row values.
- **Property (P)**: The operation SHALL complete without the
  "infinite recursion detected" error and SHALL enforce the same access rules
  the recursive policy intended to express.
- **Preservation**: All RLS-governed behavior on tables other than
  `family_members`, plus the `family_members` insert policy and the
  `handle_new_user` trigger, must remain exactly as it is today.
- **is_family_member(check_family_id)**: New `SECURITY DEFINER STABLE` SQL/PLpgSQL
  function that returns `true` if `auth.uid()` has a row in `family_members`
  for `check_family_id`, bypassing RLS internally.
- **is_family_admin(check_family_id)**: New `SECURITY DEFINER STABLE` function
  that returns `true` if `auth.uid()` has a row in `family_members` for
  `check_family_id` with `role = 'admin'`, bypassing RLS internally.
- **SECURITY DEFINER**: Postgres function attribute that runs the function
  body with the privileges (and RLS bypass, if owned by a sufficiently
  privileged role) of the function's owner rather than the calling user.
- **executedUnderRLS**: True whenever the operation is issued by a role
  subject to RLS on the target table (i.e. not a `SECURITY DEFINER` internal
  query and not a superuser/bypassrls role).

## Bug Details

### Bug Condition

The bug manifests whenever any client-facing operation touches
`family_members` while RLS is enforced — `SELECT`, and for admins any
`INSERT`/`UPDATE`/`DELETE` covered by the `"Admins can manage family
members"` `FOR ALL` policy. Both affected policies' `USING` clauses run
`SELECT family_id FROM family_members WHERE ...`, which is itself a read of
`family_members` and therefore re-invokes the same RLS policies being
evaluated, recursing until Postgres raises the error.

**Formal Specification:**
```
FUNCTION isBugCondition(X)
  INPUT: X of type DatabaseOperation
  OUTPUT: boolean

  RETURN X.targetTable = 'family_members' AND X.executedUnderRLS = true
END FUNCTION
```

### Examples

- Create-family flow: client inserts a `families` row, then inserts a
  `family_members` row for the creator. The subsequent `SELECT` (e.g. Supabase
  client re-selecting the inserted row, or any later read of that family's
  members) evaluates `"Members can view family members"`, whose subquery
  reads `family_members` again → recursion error. Expected: the insert and
  any follow-up read succeed and return the member row.
- Join-family flow: a second user inserts themselves into `family_members`
  for an existing family. Reading back the family's member list triggers the
  same recursive policy. Expected: the read returns all members of that
  family with no error.
- Admin action: a user with `role = 'admin'` in a family tries to remove
  another member (`DELETE` on `family_members`), which evaluates `"Admins can
  manage family members"`. Its subquery reads `family_members` filtered by
  `role = 'admin'`, re-triggering the same policy → recursion error. Expected:
  the delete succeeds for a genuine admin.
- Edge case: a user who belongs to zero families performs a `SELECT` against
  `family_members`. Expected: the query returns zero rows (no error), since
  `is_family_member`/`is_family_admin` simply evaluate to `false` for every
  row without recursing.

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- `families` SELECT policy (`"Members can view their families"`) continues to
  use its existing inline subquery against `family_members` and continues to
  return only families the user belongs to.
- `safe_zones`, `alerts`, `location_history`, `emergency_sessions` policies
  continue to use their existing inline
  `family_id IN (SELECT family_id FROM family_members WHERE user_id = auth.uid())`
  subqueries, unmodified, and continue to enforce the same family-scoped
  access.
- `"Users can insert themselves as member"` policy on `family_members`
  (`WITH CHECK (auth.uid() = user_id)`) is left exactly as-is.
- Non-admin users remain unable to insert, update, or delete another user's
  `family_members` row.
- The `handle_new_user` trigger and `generate_family_code` /
  `cleanup_old_locations` functions are untouched and behave identically.
- The script remains idempotent/safe to re-run: policy changes use
  `DROP POLICY IF EXISTS` before `CREATE POLICY`, and the new functions use
  `CREATE OR REPLACE FUNCTION`.

**Scope:**
All operations that do NOT target `family_members` under RLS are unaffected
by this fix. This includes:
- Reads/writes on `families`, `profiles`, `location_history`, `safe_zones`,
  `alerts`, `emergency_contacts`, `emergency_sessions`.
- The `family_members` insert-self policy path (create/join flows' own
  insert step).
- Any `SECURITY DEFINER` internal calls, which already bypass RLS today
  (e.g. `handle_new_user`).

## Hypothesized Root Cause

Based on the bug description and the current `supabase/schema.sql`:

1. **Self-referencing USING clause in "Members can view family members"**:
   the policy's `USING (family_id IN (SELECT family_id FROM family_members
   WHERE user_id = auth.uid()))` subquery reads the very table the policy
   protects, so evaluating the policy requires evaluating the policy.

2. **Self-referencing USING clause in "Admins can manage family members"**:
   same pattern, additionally filtered on `role = 'admin'`, applied to a
   `FOR ALL` policy so it recurses on every `SELECT`/`INSERT`/`UPDATE`/`DELETE`
   an admin performs against `family_members`.

3. **No RLS-bypassing indirection exists yet**: there is no `SECURITY
   DEFINER` helper that can answer "is this user a member/admin of this
   family" without going back through RLS on `family_members`, which is what
   both policies need in order to avoid recursing.

4. **Not a data or index issue**: the recursion is structural (policy
   definition), not dependent on row counts, indexes, or specific
   `family_id`/`user_id` values, which is why it manifests for every
   create/join flow rather than intermittently.

## Correctness Properties

Property 1: Bug Condition - No Recursion on family_members RLS

_For any_ database operation `X` where `X.targetTable = 'family_members'` and
`X.executedUnderRLS = true` (isBugCondition returns true), the fixed policies
SHALL allow the operation to complete without raising `"infinite recursion
detected in policy for relation \"family_members\""`, and SHALL grant or deny
access according to the same membership/admin semantics the original policies
intended (a user sees rows for families they belong to; only admins can
modify/delete other members' rows).

**Validates: Requirements 2.1, 2.2, 2.3**

Property 2: Preservation - Non-Recursive Operations Unaffected

_For any_ database operation `X` where `X.targetTable != 'family_members'`
OR `X.executedUnderRLS = false` (isBugCondition returns false), the fixed
schema SHALL produce exactly the same result as the original schema,
preserving `families`/`safe_zones`/`alerts`/`location_history`/
`emergency_sessions` access rules, the `family_members` self-insert policy,
and the `handle_new_user` signup trigger.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**

## Fix Implementation

### Changes Required

**File**: `supabase/schema.sql`

**New objects**: `is_family_member(check_family_id UUID)`,
`is_family_admin(check_family_id UUID)`

**Modified objects**: policies `"Members can view family members"` and
`"Admins can manage family members"` on `family_members`

**Specific Changes**:

1. **Add helper function `is_family_member`**: `SECURITY DEFINER STABLE`
   function returning `boolean`, defined before the `family_members` policies
   (functions are typically grouped in the "Functions" section, but these two
   must be created before the policies that reference them, or the policy
   `CREATE POLICY` statements will fail to resolve the function call — so they
   will be placed immediately before the RLS policy block instead of in the
   later "Functions" section):
   ```sql
   CREATE OR REPLACE FUNCTION is_family_member(check_family_id UUID)
   RETURNS BOOLEAN AS $$
     SELECT EXISTS (
       SELECT 1 FROM family_members
       WHERE family_id = check_family_id AND user_id = auth.uid()
     );
   $$ LANGUAGE sql SECURITY DEFINER STABLE;
   ```

2. **Add helper function `is_family_admin`**: same shape, additionally
   filtered to `role = 'admin'`:
   ```sql
   CREATE OR REPLACE FUNCTION is_family_admin(check_family_id UUID)
   RETURNS BOOLEAN AS $$
     SELECT EXISTS (
       SELECT 1 FROM family_members
       WHERE family_id = check_family_id AND user_id = auth.uid() AND role = 'admin'
     );
   $$ LANGUAGE sql SECURITY DEFINER STABLE;
   ```
   Both use `CREATE OR REPLACE FUNCTION` so the script stays safe to re-run.

3. **Rewrite `"Members can view family members"`**: keep the
   `DROP POLICY IF EXISTS` guard, change the `USING` clause to call the
   helper instead of the inline subquery:
   ```sql
   DROP POLICY IF EXISTS "Members can view family members" ON family_members;
   CREATE POLICY "Members can view family members" ON family_members
     FOR SELECT USING (is_family_member(family_id));
   ```

4. **Rewrite `"Admins can manage family members"`**: same guard pattern,
   `USING` clause calls `is_family_admin`:
   ```sql
   DROP POLICY IF EXISTS "Admins can manage family members" ON family_members;
   CREATE POLICY "Admins can manage family members" ON family_members
     FOR ALL USING (is_family_admin(family_id));
   ```

5. **Leave everything else untouched**: `"Users can insert themselves as
   member"`, the `families`/`safe_zones`/`alerts`/`location_history`/
   `emergency_sessions` policies, `handle_new_user`, `generate_family_code`,
   `cleanup_old_locations`, indexes, and Realtime publication block all stay
   exactly as they are today. No table structure changes.

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface the
recursion error against the current (unfixed) schema to confirm the root
cause, then verify the fixed schema both resolves the recursion for
`family_members` operations and leaves every other policy's behavior
identical.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the recursion BEFORE
applying the fix, and confirm the root cause is the self-referencing
`USING` clauses rather than something else (e.g. a trigger, a foreign key
constraint, or client-side retry logic).

**Test Plan**: Against a database loaded with the current `supabase/schema.sql`,
run the create-family and join-family flows (or equivalent direct SQL) and
capture the exact Postgres error. Also directly `SELECT * FROM
family_members` and perform an admin `DELETE` as a role subject to RLS, to
isolate which of the two policies recurses.

**Test Cases**:
1. **Insert-then-select on create-family**: insert a `families` row, insert a
   `family_members` row for the creator, then `SELECT` from `family_members`
   for that family (will fail on unfixed schema with the recursion error).
2. **Join-family select**: insert a second `family_members` row for an
   existing family, then `SELECT` the family's member list (will fail on
   unfixed schema).
3. **Admin delete**: as a `role = 'admin'` member, `DELETE` another member's
   `family_members` row (will fail on unfixed schema, since `"Admins can
   manage family members"` also recurses).
4. **Zero-membership select**: as a user with no `family_members` rows,
   `SELECT * FROM family_members` (may still fail on unfixed schema, since
   the recursion is structural and independent of row existence).

**Expected Counterexamples**:
- Every `SELECT`/admin-write against `family_members` under RLS raises
  `infinite recursion detected in policy for relation "family_members"`.
- Confirms the root cause is the policy definitions themselves, not data or
  timing, since even the zero-row case fails identically.

### Fix Checking

**Goal**: Verify that for all operations where the bug condition holds
(target table is `family_members`, executed under RLS), the fixed schema
completes without the recursion error and enforces the intended
membership/admin semantics.

**Pseudocode:**
```
FOR ALL X WHERE isBugCondition(X) DO
  result := F'(X)
  ASSERT result.error != "infinite recursion detected in policy for relation \"family_members\""
  ASSERT result.completedSuccessfully = true
  ASSERT result.rowsVisible = { rows in family_members where is_family_member(row.family_id) }
END FOR
```

### Preservation Checking

**Goal**: Verify that for all operations where the bug condition does NOT
hold, the fixed schema produces the same result as the original schema.

**Pseudocode:**
```
FOR ALL X WHERE NOT isBugCondition(X) DO
  ASSERT F(X) = F'(X)
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation
checking because:
- It generates many combinations of family/user/role fixtures automatically,
  which is important here since `family_members` access rules depend on
  three-way relationships (user, family, role).
- It catches edge cases like users belonging to multiple families, or a user
  who is admin in one family but a plain member in another, that hand-written
  fixtures might miss.
- It provides strong guarantees that the untouched policies on `families`,
  `safe_zones`, `alerts`, `location_history`, and `emergency_sessions` truly
  remain byte-for-byte unchanged in behavior.

**Test Plan**: Observe behavior on the UNFIXED schema first for the
non-recursive paths (self-insert into `family_members`, reads/writes on the
other tables, signup trigger), record the observed results as the baseline,
then write tests against the fixed schema asserting the same results.

**Test Cases**:
1. **Self-insert preservation**: verify a user can still insert their own
   `family_members` row (create/join flow) after the fix, matching unfixed
   behavior.
2. **Families visibility preservation**: verify `"Members can view their
   families"` still returns exactly the same family set for a given user
   before and after the fix.
3. **Cross-table membership checks preservation**: verify `safe_zones`,
   `alerts`, `location_history`, `emergency_sessions` SELECT/INSERT policies
   return/allow the same rows before and after the fix, for the same
   fixtures.
4. **Non-admin write denial preservation**: verify a non-admin still cannot
   update/delete another user's `family_members` row after the fix.
5. **Signup trigger preservation**: verify `handle_new_user` still creates a
   `profiles` row identically after the fix (unrelated table, sanity check
   that the migration didn't disturb it).

### Unit Tests

- Test `is_family_member` returns `true` only for `(user, family)` pairs with
  an existing `family_members` row, and `false` otherwise, including for
  non-existent `family_id` values.
- Test `is_family_admin` returns `true` only when the row's `role = 'admin'`,
  and `false` for `role = 'member'` or no row.
- Test that `SELECT` and admin `DELETE`/`UPDATE` on `family_members` no
  longer raise the recursion error under RLS.

### Property-Based Tests

- Generate random sets of families and memberships (varying roles, varying
  numbers of members per family) and verify `is_family_member`/
  `is_family_admin` agree with a naive reference implementation for every
  `(user, family)` pair.
- Generate random users with membership in zero, one, or many families and
  verify `SELECT * FROM family_members` under RLS returns exactly the rows
  where `is_family_member(family_id)` holds, with no errors.
- Generate random combinations of admin/non-admin actors attempting writes on
  `family_members` and verify allow/deny outcomes match the original policy
  intent (admin of that family → allowed; anyone else → denied) across many
  scenarios.

### Integration Tests

- Full create-family flow end-to-end (insert family, insert self as admin
  member, read back member list) with no recursion error.
- Full join-family flow end-to-end (existing family, new user inserts self as
  member, read back updated member list) with no recursion error.
- Regression flow: exercise `safe_zones`, `alerts`, `location_history`, and
  `emergency_sessions` read/write paths for an existing family after applying
  the fix, confirming identical access behavior to the pre-fix schema.
