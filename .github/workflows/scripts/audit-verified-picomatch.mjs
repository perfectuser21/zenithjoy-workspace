import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const advisory = 'https://github.com/advisories/GHSA-fc5q-39xc-vjpf';
const patched = {
  '2.3.2': 'sha512-zKm3VTKWjlUSfUNZGnxrj4Tb7pZl5hvpHnApO7v/l0QKge0UY0/CuLlMomaNLPM8ANv5Q29qVJWWdfMJzbFYdA==',
  '4.0.7': 'sha512-Ic3141UWi33aG6S0MfPVeb4ktmkd80nZIYhZiLvpdW63eWhUD+RZg+JKcKl8pub7K3mcpXfqTgqJ7UXYg0KtVg==',
};

function verifiedArchives(report) {
  const advisoryReport = report.picomatch;
  if (!advisoryReport?.via?.length || !advisoryReport.via.every(entry => entry?.url === advisory)) return false;
  const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
  const copies = Object.entries(lock.packages ?? {}).filter(([path, pkg]) =>
    path.endsWith('node_modules/picomatch') || pkg.name === 'picomatch');
  if (!copies.length || !advisoryReport.nodes?.length ||
      !advisoryReport.nodes.every(node => copies.some(([path]) => path === node))) return false;
  return copies.every(([, { version, resolved, integrity }]) => {
    if (!Object.hasOwn(patched, version) || patched[version] !== integrity) return false;
    const archive = `vendor/picomatch-security/picomatch-${version}.tgz`;
    if (![archive, 'apps/dashboard/' + archive].some(path => resolved === 'file:' + path)) return false;
    try {
      const actual = createHash('sha512').update(readFileSync(resolved.slice(5))).digest('base64');
      return integrity === 'sha512-' + actual;
    } catch {
      return false;
    }
  });
}

function exemptedMetavulnerabilities(report) {
  if (!verifiedArchives(report)) return [];
  const mitigated = new Set(['picomatch']);
  // An npm metavulnerability is reportable if any active cause remains. Only
  // propagate mitigation through packages for which at least one cause is this
  // patched advisory and all other causes are mitigated or below high severity.
  let changed;
  do {
    changed = false;
    for (const [name, entry] of Object.entries(report)) {
      if (mitigated.has(name) || !Array.isArray(entry.via)) continue;
      if (entry.via.some(cause => mitigated.has(cause)) &&
          entry.via.every(cause => mitigated.has(cause) ||
            ['info', 'low', 'moderate'].includes(
              typeof cause === 'string' ? report[cause]?.severity : cause?.severity))) {
        mitigated.add(name);
        changed = true;
      }
    }
  } while (changed);
  return [...mitigated];
}

const report = JSON.parse(readFileSync(0, 'utf8'));
console.log(JSON.stringify(exemptedMetavulnerabilities(report.vulnerabilities)));
