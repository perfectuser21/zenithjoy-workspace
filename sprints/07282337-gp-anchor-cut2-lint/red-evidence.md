  PASS [empty-body]
  FAIL [empty-body: missing GP-ANCHOR-MISSING]
bash: .github/workflows/scripts/lint-gp-anchor.sh: No such file or directory
  PASS [no-anchor-line]
  FAIL [no-anchor-line: missing GP-ANCHOR-MISSING]
bash: .github/workflows/scripts/lint-gp-anchor.sh: No such file or directory
  PASS [multiple-anchor-lines]
  FAIL [multiple-anchor-lines: missing GP-ANCHOR-MULTIPLE]
bash: .github/workflows/scripts/lint-gp-anchor.sh: No such file or directory
  PASS [nonexistent-id]
  FAIL [nonexistent-id: missing GP-ANCHOR-ID-NOTFOUND]
bash: .github/workflows/scripts/lint-gp-anchor.sh: No such file or directory
  FAIL [self-bootstrap-progressing] expect_fail=0 got_rc=127
bash: .github/workflows/scripts/lint-gp-anchor.sh: No such file or directory
  FAIL [keep-green] expect_fail=0 got_rc=127
bash: .github/workflows/scripts/lint-gp-anchor.sh: No such file or directory
  FAIL [none-docs] expect_fail=0 got_rc=127
bash: .github/workflows/scripts/lint-gp-anchor.sh: No such file or directory
  PASS [none-invalid-category]

lint-gp-anchor: PASSED=5 FAILED=7
