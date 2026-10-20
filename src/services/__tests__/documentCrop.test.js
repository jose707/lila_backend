const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseCropRect } = require('../documentCrop');

test('parses the same side-specific camera crop fields used by identity upload', () => {
  assert.deepEqual(parseCropRect({
    ciFrontCropX: '20', ciFrontCropY: '30', ciFrontCropW: '300', ciFrontCropH: '190',
    ciFrontCropScreenW: '400', ciFrontCropScreenH: '800',
  }, 'ciFront'), { x: 20, y: 30, w: 300, h: 190, screenW: 400, screenH: 800 });
});

test('rejects invalid or out-of-frame camera crop metadata', () => {
  assert.equal(parseCropRect({ ciBackCropX: '-1' }, 'ciBack'), null);
  assert.equal(parseCropRect({
    ciBackCropX: '350', ciBackCropY: '0', ciBackCropW: '100', ciBackCropH: '100',
    ciBackCropScreenW: '400', ciBackCropScreenH: '800',
  }, 'ciBack'), null);
});
