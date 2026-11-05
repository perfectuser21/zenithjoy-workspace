// Fixture input selected before launch by the Darwin CI identity probe; never a production override.
export const preflightTestPython = process.env.PREFLIGHT_TEST_PYTHON_BIN || '/usr/bin/python3';
