#!/usr/bin/env python3
"""Run the real unittest collection; empty, skipped and import failures are red."""
import os
import re
import sys
import unittest
for key in list(os.environ):
    if re.search(r'API_KEY|SECRET|TOKEN|PASSWORD|PRIVATE_KEY', key, re.I):
        del os.environ[key]
os.environ['PYTHONDONTWRITEBYTECODE'] = '1'
if len(sys.argv) != 3:
    sys.exit('executed Python contracts require a directory and pattern')
suite = unittest.defaultTestLoader.discover(sys.argv[1], pattern=sys.argv[2])
result = unittest.TextTestRunner(verbosity=2).run(suite)
if not result.wasSuccessful() or result.testsRun == 0 or result.skipped or result.expectedFailures or result.unexpectedSuccesses:
    sys.exit('executed Python contracts must pass with nonempty collection and zero skips')
print(f'executed Python contracts: tests={result.testsRun} skipped=0')
