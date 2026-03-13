# Bugfix Requirements Document

## Introduction

The 9Router system modifies DNS settings (`/etc/hosts`) to enable MITM proxy functionality for intercepting Antigravity traffic. When the system crashes or is improperly terminated, DNS entries may remain in the system, permanently blocking IDE connectivity to Antigravity. This bug can completely disable developer workflows until manual DNS cleanup is performed.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN 9Router process crashes or is killed with SIGKILL (kill -9) THEN the DNS cleanup script may not execute, leaving `127.0.0.1 daily-cloudcode-pa.googleapis.com` entry in `/etc/hosts`

1.2 WHEN DNS entry remains in `/etc/hosts` after 9Router termination THEN the IDE cannot connect to Antigravity, appearing as network timeout or connection failure

1.3 WHEN emergency DNS cleanup script (`emergency-dns-cleanup.sh`) fails due to permission issues or script errors THEN manual intervention is required to restore connectivity

1.4 WHEN `dns-manager.sh` script is missing or not executable THEN DNS cleanup during normal stop operations fails silently

### Expected Behavior (Correct)

2.1 WHEN 9Router process terminates (any method) THEN the system SHALL automatically clean up DNS entries from `/etc/hosts`

2.2 WHEN DNS cleanup fails during normal stop THEN the system SHALL provide clear error messages and fallback recovery options

2.3 WHEN emergency cleanup is needed THEN the emergency script SHALL work reliably with proper error handling and user guidance

2.4 WHEN scripts are missing or not executable THEN the system SHALL detect this and provide actionable recovery instructions

### Unchanged Behavior (Regression Prevention)

3.1 WHEN 9Router is started normally with `./9router.sh start` THEN the system SHALL CONTINUE TO properly set up DNS entries for MITM functionality

3.2 WHEN 9Router is stopped normally with `./9router.sh stop` THEN the system SHALL CONTINUE TO clean up DNS entries successfully

3.3 WHEN MITM proxy is active THEN the system SHALL CONTINUE TO correctly intercept and route Antigravity traffic

3.4 WHEN DNS status is checked with `./9router.sh dns-status` THEN the system SHALL CONTINUE TO accurately report DNS configuration state