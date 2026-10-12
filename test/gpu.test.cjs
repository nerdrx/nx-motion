'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { planFrames, rifeArgs } = require('../src/gpu.cjs');

test('GPU staging respects trim, preview and scaling, and bounds disk usage', () => {
  const details = { duration: 120, fps: 30, width: 3840, height: 2160 };
  const plan = planFrames(details, { fps: 60, resolution: '720', trimStart: 10, trimDuration: 20, previewSeconds: 5 });
  assert.equal(plan.duration, 5);
  assert.equal(plan.sourceCount, 150);
  assert.equal(plan.targetCount, 300);
  assert.equal(plan.height, 720);
  assert.ok(plan.estimatedBytes > 1280 * 720 * 3 * 450);
  assert.throws(() => planFrames({ ...details, duration: null }, { fps: 60, resolution: 'original' }), /known duration/);
  assert.throws(() => planFrames(details, { fps: 60, resolution: 'original', trimStart: 120 }), /beyond/);
});

test('RIFE uses Vulkan GPU, explicit frame count and UHD only for large frames', () => {
  const args = rifeArgs('in', 'out', 'model', 300, 2160);
  assert.equal(args[args.indexOf('-g') + 1], '0');
  assert.equal(args[args.indexOf('-n') + 1], '300');
  assert.ok(args.includes('-u'));
  assert.ok(!rifeArgs('in', 'out', 'model', 60, 720).includes('-u'));
});
