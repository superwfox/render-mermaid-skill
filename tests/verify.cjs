'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PNG } = require('pngjs');

const root = path.resolve(__dirname, '..');
const svgPath = path.join(root, 'tests', 'output', 'fixture.svg');
const pngPath = path.join(root, 'tests', 'output', 'fixture-2x.png');
const svg = fs.readFileSync(svgPath, 'utf8');
const png = PNG.sync.read(fs.readFileSync(pngPath));

for (const label of ['对外展示平台', '官网', '飞书机器人群', '自动化工作流', '飞书', 'CRM系统', '未来接口']) {
  assert.ok(svg.includes(label), `SVG is missing label: ${label}`);
}

const width = Number(svg.match(/<svg\b[^>]*\bwidth="([0-9]+)"/i)?.[1]);
const height = Number(svg.match(/<svg\b[^>]*\bheight="([0-9]+)"/i)?.[1]);
assert.ok(width > 0 && height > 0, 'SVG dimensions are invalid');
assert.equal(png.width, width * 2, 'PNG width is not 2× SVG width');
assert.equal(png.height, height * 2, 'PNG height is not 2× SVG height');

let transparent = 0;
let opaque = 0;
for (let index = 3; index < png.data.length; index += 4) {
  if (png.data[index] === 0) transparent += 1;
  if (png.data[index] === 255) opaque += 1;
}
assert.ok(transparent > 0, 'PNG has no transparent pixels');
assert.ok(opaque > 0, 'PNG has no opaque pixels');

process.stdout.write(`${JSON.stringify({
  svg: { width, height },
  png: { width: png.width, height: png.height },
  alpha: { transparent, opaque },
}, null, 2)}\n`);
