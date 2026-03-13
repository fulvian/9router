# Implementation Plan

- [-] 1. Write bug condition exploration test
  - **Property 1: Bug Condition** - DNS Cleanup Failure Detection
  - **CRITICAL**: This test MUST FAIL on unfixed code - failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior - it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate DNS cleanup failures exist
  - **Scoped PBT Approach**: For deterministic bugs, scope the property to concrete failing cases to ensure reproducibility
  - Test that simulates 9Router crash (SIGKILL) leaves DNS entry in `/etc/hosts` (from Bug Condition in design)
  - Test that missing `dns-manager.sh` script causes cleanup failure
  - Test that non-executable `dns-manager.sh` causes cleanup failure
  - Run test on UNFIXED code
  - **EXPECTED OUTCOME**: Test FAILS (this is correct - it proves the bug exists)
  - Document counterexamples found to understand root cause
  - Mark task complete when test is written, run, and failure is documented
  - _Requirements: 1.1, 1.2, 1.3, 1.4_

- [ ] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - Normal DNS Management Behavior
  - **IMPORTANT**: Follow observation-first methodology
  - Observe: `./9router.sh start` adds DNS entry correctly on unfixed code
  - Observe: `./9router.sh stop` removes DNS entry correctly on unfixed code
  - Observe: `./9router.sh dns-status` reports accurately on unfixed code
  - Write property-based test: for all normal operations (start, stop, status), behavior matches observed patterns (from Preservation Requirements in design)
  - Property-based testing generates many test cases for stronger guarantees
  - Run tests on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (this confirms baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [ ] 3. Fix for DNS cleanup reliability bug

  - [ ] 3.1 Implement process supervision enhancement
    - Add Node.js uncaughtException and unhandledRejection handlers in `src/server-init.js`
    - Trap SIGTERM/SIGINT signals in `9router.sh` for graceful cleanup
    - Implement crash recovery hook that calls DNS cleanup
    - Add process exit handlers to ensure cleanup runs
    - _Bug_Condition: isBugCondition(terminationEvent, systemState) from design_
    - _Expected_Behavior: expectedBehavior(result) from design_
    - _Preservation: Preservation Requirements from design_
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.3, 3.4_

  - [ ] 3.2 Improve error handling in DNS scripts
    - Add comprehensive error checking in `scripts/dns-manager.sh`
    - Implement permission validation with clear user feedback
    - Add missing script detection with recovery instructions
    - Make DNS operations idempotent (safe to run multiple times)
    - Enhance `scripts/emergency-dns-cleanup.sh` with better diagnostics
    - _Bug_Condition: isBugCondition(terminationEvent, systemState) from design_
    - _Expected_Behavior: expectedBehavior(result) from design_
    - _Preservation: Preservation Requirements from design_
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.3, 3.4_

  - [ ] 3.3 Implement atomic DNS operations
    - Add pre-modification backup of `/etc/hosts` in `dns-manager.sh`
    - Implement rollback mechanism on failure
    - Add verification steps after cleanup completion
    - Create transactional approach to DNS modifications
    - _Bug_Condition: isBugCondition(terminationEvent, systemState) from design_
    - _Expected_Behavior: expectedBehavior(result) from design_
    - _Preservation: Preservation Requirements from design_
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.3, 3.4_

  - [ ] 3.4 Enhance user guidance and recovery
    - Add clear error messages with actionable steps in all scripts
    - Implement proactive blockage detection in `9router.sh`
    - Enhance emergency script with automated recovery suggestions
    - Add health check endpoint for IDE connectivity verification
    - _Bug_Condition: isBugCondition(terminationEvent, systemState) from design_
    - _Expected_Behavior: expectedBehavior(result) from design_
    - _Preservation: Preservation Requirements from design_
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.3, 3.4_

  - [ ] 3.5 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - DNS Cleanup Reliability
    - **IMPORTANT**: Re-run the SAME test from task 1 - do NOT write a new test
    - The test from task 1 encodes the expected behavior
    - When this test passes, it confirms the expected behavior is satisfied
    - Run bug condition exploration test from step 1
    - **EXPECTED OUTCOME**: Test PASSES (confirms bug is fixed)
    - _Requirements: Expected Behavior Properties from design_

  - [ ] 3.6 Verify preservation tests still pass
    - **Property 2: Preservation** - Normal DNS Management Behavior
    - **IMPORTANT**: Re-run the SAME tests from task 2 - do NOT write new tests
    - Run preservation property tests from step 2
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions)
    - Confirm all tests still pass after fix (no regressions)

- [ ] 4. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.