# Retired Windows customer-service nightly scope

The user confirmed that current customer service uses Android RPA. The old
Windows `wechat-bubble`/PsExec nightly lane is retired, including its temporary
exit-node commands, dependencies and report fields. This does not retire the
approved Line02 Douyin read-side profile, exact candidate SHA, interactive user,
process-tree cleanup or shared `zj-rog-desktop` exclusion group. The original
Android account-scan lane and its failure/notification policy remain intact.

The release nightly check still requires two distinct completed **main** runs,
correct repository/workflow/event identity, a latest run no older than 36 hours,
a complete job list and successful current Douyin jobs. Generic Android results
retain the existing separate warning policy. Account-scan is not Android
customer-service delivery evidence.

Current Android CS's 83 offline CI cases prove their declared local contracts;
they are not a new physical acceptance run. For API releases affecting current
Android CS, the existing mandatory Brain acceptance step still reads the frozen
same-SHA business S2/S3 checks: actual affected business/persisted independent
readback, plus failure/recovery without duplicate or cross-tenant writes. The
frozen contract names/hash and candidate two-source SHA validation are unchanged.
Neither offline CI nor account-scan may be presented as CS message delivery.

The deleted sparse-checkout linter and desktop mutex smoke were consumers of
that retired Windows CS workflow/PsExec wiring. They did not independently prove
an Android behavior. Shared desktop broker/Line02 mutex runtime, Node tests,
Python runtime tests and SDK tests are not changed by this retirement.
Original Git restore coordinates and content hashes are recorded in the adjacent
JSON file. No historical run, receipt, device data or production lease is deleted.

BASELINE-REMOVE: line04-ci-desktop-mutex-smoke.sh — sole old Windows CS/PsExec workflow guard; no unique current Android protection; shared broker/Line02 runtime and its real Node/Python/SDK tests retained unchanged, and mandatory same-SHA frozen Brain S2/S3 retained.
