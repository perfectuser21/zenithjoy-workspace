#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "$repo_root/apps/api"
npx vitest run src/routes/__tests__/video-tools.test.ts src/routes/__tests__/video-tools-direct-upload.test.ts src/routes/__tests__/video-tools-image-generation.test.ts src/services/__tests__/ali-video-provider.test.ts src/services/__tests__/creative-image-provider.test.ts src/services/creative-canvas-gateway.test.ts
cd "$repo_root/apps/dashboard"
npx vitest run src/pages/__tests__/VideoToolsPage.test.tsx src/pages/__tests__/CreativeCanvasPage.test.tsx src/config/__tests__/navigation.config.test.ts
# Validate the checked-in starter graph before it is distributed by the canvas.
cd "$repo_root"
node <<'NODE'
const assert = require('node:assert/strict');
const graph = require('./infrastructure/comfyui/workflows/image2-select-wan.json');
const types = graph.nodes.map(node => node.type);
for (const type of ['ZenithJoyImage2', 'ZenithJoyChooseAsset', 'ZenithJoyWan', 'SaveVideo']) assert.ok(types.includes(type), `missing ${type}`);
for (const node of graph.nodes.filter(node => ['ZenithJoyImage2', 'ZenithJoyWan'].includes(node.type))) assert.equal(node.widgets_values_named.request_id, '', 'starter graph must not reuse a request ID');
assert.ok(graph.links.some(link => link[5] === 'ZENITHJOY_ASSET'), 'starter graph must connect owned assets');
NODE
cd "$repo_root/apps/api"
npx vitest run src/services/creative-canvas-configured.test.ts
