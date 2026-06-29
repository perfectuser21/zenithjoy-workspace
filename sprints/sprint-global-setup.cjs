// Global setup: ensure CWD is workspace root when running sprint tests
const path = require('path');

module.exports = function setup() {
  process.chdir(path.resolve(__dirname, '..'));
};

module.exports.teardown = function teardown() {};
