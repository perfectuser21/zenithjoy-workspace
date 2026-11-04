# Retired smoke shells

These historical CI shells retain their exact bytes and restoration hashes in [retirements.json](retirements.json). Moving them outside `.github/workflows/scripts/smoke/*.sh` removes their automatic execution; no passing result is substituted.

- `creator-service-smoke.sh`: the former port 8899 Creator HTTP implementation is absent. The current API workflow retains Topic → Pipeline → Worker acceptance.
- `line07-video-remake-smoke.sh`: the Python prototype returns completed for node confirmation without rendering. The current Dashboard and Node video-remake pipeline use a different, mounted job protocol and retain their current tests.

Neither shell has a smoke baseline or false-green-debt entry to remove. Current API/UI implementations, compatibility services, deployment artifacts and historical receipts are unchanged. Restoring a shell for a new consumer requires checking that consumer's actual protocol and execution scope.
