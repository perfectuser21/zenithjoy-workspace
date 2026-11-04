#!/usr/bin/env node
// Local candidate provenance only. This helper has no remote publishing capability.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const component = process.argv[2];
if (!['core', 'line01', 'line02', 'line04', 'line05'].includes(component)) {
  throw new Error('Expected core or an existing installpack module');
}
const sourceSha = process.env.CANDIDATE_SOURCE_SHA;
if (!/^[0-9a-f]{40}$/.test(sourceSha || '')) {
  throw new Error('CANDIDATE_SOURCE_SHA must be a full immutable commit SHA');
}
const directory = component === 'core' ? 'dist-installpack' : 'dist-modules';
const manifestPath = path.join(directory, 'manifest.json');
const manifestSource = component === 'core' ? manifestPath : path.join('modules', component, 'manifest.json');
const manifestBytes = fs.readFileSync(manifestSource);
const manifest = JSON.parse(manifestBytes.toString('utf8'));
if (!/^\d+\.\d+\.\d+$/.test(manifest.version || '')) throw new Error('Invalid package manifest version');
if (component !== 'core' && !/^[a-z0-9-]+$/.test(manifest.lineId || '')) throw new Error('Invalid module lineId');
const archiveName = `${component === 'core' ? 'zenithjoy-agent' : manifest.lineId}-v${manifest.version}.tar.gz`;
function fingerprint(name) {
  const bytes = fs.readFileSync(path.join(directory, name));
  return { name, sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length };
}
const archive = fingerprint(archiveName);
if (component === 'core' && (manifest.sha256 !== archive.sha256 || manifest.size !== archive.size)) {
  throw new Error('Core archive does not match its build manifest hash and size');
}
if (component !== 'core') fs.writeFileSync(manifestPath, manifestBytes);
const files = [archive, fingerprint('manifest.json')];
const receipt = { candidate_only: true, source_sha: sourceSha, component, version: manifest.version, files };
fs.writeFileSync(path.join(directory, 'candidate-receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
const checksums = [...files, fingerprint('candidate-receipt.json')];
fs.writeFileSync(path.join(directory, 'SHA256SUMS'), checksums.map(file => `${file.sha256}  ${file.name}\n`).join(''));
console.log(`[candidate] retained ${component} ${manifest.version} from ${sourceSha}; no production write`);
