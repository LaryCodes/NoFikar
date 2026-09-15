# Implementation Plan

- [ ] 1. Write bug condition exploration test
  - **Property 1: Bug Condition** - No Recursion on family_members RLS
  - **CRITICAL**: This test MUST FAIL on unfixed code - failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior - it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate the recursive-policy bug exists
  - Create `supabase/tests/family_members_rls_recursion.test.sql` (pgTAP, run via `supabase test db` or `psql` against a local Postgres loaded with the current unfixed `supabase/schema.sql`)
  - Set up fixtures: two `auth.users` rows (`admin_user`, `member_user`), one `families` row created by `admin_user`, and `family_members` rows for both users (`admin_user` with `role = 'admin'`, `member_user` with `role = 'member'`), inserted as the service role (bypassing RLS) so fixture setup itself does not hit the bug
  - **Scoped PBT Approach**: Since the bug condition (`isBugCondition`) is `X.targetTable = 'family_members' AND X.executedUnderRLS = true` and depends only on *which table* is touched under RLS, not on row values, scope the property to concrete representative operations rather than generating random data: (a) `SELECT * FROM family_members` as `member_user`, (b) `DELETE FROM family_members WHERE user_id = member_user.id` as `admin_user`
  - For each case, simulate the calling user by running `SELECT set_config('request.jwt.claim.sub', '<user-uuid>', true);` then `SET ROLE authenticated;` before the query, `RESET ROLE;` after (standard technique for exercising Supabase RLS from raw SQL)
  - Assert (from Bug Condition in design, `isBugCondition(X)` where `X.targetTable = 'family_members'` and `X.executedUnderRLS = true`): the query does NOT raise `infinite recursion detected in policy for relation "family_members"`, and completes successfully returning/affecting the expected rows (`member_user` sees rows where `is_family_member(family_id)` would hold; `admin_user`'s delete succeeds)
  - Run test on UNFIXED `supabase/schema.sql`
  - **EXPECTED OUTCOME**: Test FAILS - both the `SELECT` and the admin `DELETE` raise `infinite recursion detected in policy for relation "family_members"` (this is correct - it proves the bug exists)
  - Document counterexamples found, e.g. "`SELECT * FROM family_members` as `member_user` raises `infinite recursion detected in policy for relation \"family_members\"` instead of returning the two fixture rows" and "`DELETE ... as admin_user` raises the same error instead of removing `member_user`'s row"
  - Mark task complete when test is written, run, and failure is documented
  - _Requirements: 1.1, 1.2, 1.3_

- [ ] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - Non-Recursive Operations Unaffected
  - **IMPORTANT**: Follow observation-first methodology
  - Extend `supabase/tests/family_members_rls_recursion.test.sql` (or a sibling file `supabase/tests/family_members_preservation.test.sql`) with cases where `isBugCondition(X)` is false: `X.targetTable != 'family_members'`, plus the `family_members` self-insert path
  - Using the same JWT-simulation technique, observe on the UNFIXED schema and record as baseline:
    - `member_user` self-inserting a new `family_members` row (create/join flow) succeeds
    - `member_user` querying `families` returns only the family(ies) they belong to (via the untouched `"Members can view their families"` policy)
    - `member_user` querying `safe_zones`/`alerts`/`location_history` scoped to their family returns the same rows the inline `family_id IN (SELECT ...)` subqueries produce
    - `member_user` (non-admin) attempting to `UPDATE`/`DELETE` `admin_user`'s `family_members` row is denied
    - Inserting a row into `auth.users` still results in exactly one corresponding `profiles` row via `handle_new_user`, unaffected
  - **Property-Based Approach**: write a PL/pgSQL loop (or pgTAP `SELECT` generator) that creates N randomized fixtures — varying numbers of families per test run, users with membership in zero/one/many families, and mixed admin/member roles — and asserts for each generated fixture that the observed non-`family_members`-RLS results above hold, per Preservation Requirements in design
  - Verify all these tests PASS on UNFIXED code (they must, since none of them touch the recursive policies)
  - **EXPECTED OUTCOME**: Tests PASS (this confirms the baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [ ] 3. Fix infinite recursion in family_members RLS policies

  - [x] 3.1 Implement the fix in supabase/schema.sql
    - Add `is_family_member(check_family_id UUID)`: `SECURITY DEFINER STABLE` SQL function returning `EXISTS (SELECT 1 FROM family_members WHERE family_id = check_family_id AND user_id = auth.uid())`, defined with `CREATE OR REPLACE FUNCTION` immediately before the `family_members` RLS policy block (NOT in the later "Functions" section, since the policies below need it to already exist)
    - Add `is_family_admin(check_family_id UUID)`: same shape as above, additionally filtered to `role = 'admin'`, also placed immediately before the policy block, also `CREATE OR REPLACE FUNCTION`
    - Rewrite `"Members can view family members"`: keep `DROP POLICY IF EXISTS` guard, change `USING` clause from the self-referencing inline subquery to `USING (is_family_member(family_id))`
    - Rewrite `"Admins can manage family members"`: keep `DROP POLICY IF EXISTS` guard, change `USING` clause to `USING (is_family_admin(family_id))`
    - Leave `"Users can insert themselves as member"`, all policies on `families`/`safe_zones`/`alerts`/`location_history`/`emergency_sessions`/`emergency_contacts`, `handle_new_user`, `generate_family_code`, `cleanup_old_locations`, indexes, and the Realtime publication block completely untouched
    - _Bug_Condition: isBugCondition(X) = X.targetTable = 'family_members' AND X.executedUnderRLS = true_
    - _Expected_Behavior: fixed policies allow the operation to complete without raising "infinite recursion detected in policy for relation \"family_members\"", granting/denying access per the same membership/admin semantics (is_family_member / is_family_admin)_
    - _Preservation: families/safe_zones/alerts/location_history/emergency_sessions policies, the family_members self-insert policy, and handle_new_user remain byte-for-byte unchanged in behavior_
    - _Requirements: 2.1, 2.2, 2.3_

  - [ ] 3.2 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - No Recursion on family_members RLS
    - **IMPORTANT**: Re-run the SAME test from task 1 against the FIXED `supabase/schema.sql` - do NOT write a new test
    - The test from task 1 encodes the expected behavior (no recursion error, correct rows visible/affected)
    - Run `supabase/tests/family_members_rls_recursion.test.sql` from step 1 against a database loaded with the fixed schema
    - **EXPECTED OUTCOME**: Test PASSES for both cases - `member_user`'s `SELECT` returns the two fixture rows with no error, and `admin_user`'s `DELETE` succeeds with no error (confirms the bug is fixed)
    - _Requirements: 2.1, 2.2, 2.3_

  - [ ] 3.3 Verify preservation tests still pass
    - **Property 2: Preservation** - Non-Recursive Operations Unaffected
    - **IMPORTANT**: Re-run the SAME tests from task 2 - do NOT write new tests
    - Run the preservation tests from step 2 against the fixed schema
    - **EXPECTED OUTCOME**: Tests PASS - self-insert, `families` visibility, `safe_zones`/`alerts`/`location_history` scoping, non-admin write denial, and `handle_new_user` all behave identically to the recorded unfixed-schema baseline
    - Confirm all tests still pass after fix (no regressions)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [ ] 4. Checkpoint - Ensure all tests pass
  - Run the full `supabase/tests/` suite (exploration + preservation) against the fixed `supabase/schema.sql`
  - Manually exercise the create-family and join-family flows from `/onboarding` end-to-end against a local Supabase instance loaded with the fixed schema, confirming no `infinite recursion detected` error appears
  - Ensure all tests pass, ask the user if questions arise
