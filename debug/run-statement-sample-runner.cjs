// Debug-only runner: makes Node understand the TS path alias "@/" by mapping it to dist-debug/src.
// This file is not used by the Next.js app.
const Module = require('module');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const distSrcRoot = path.join(projectRoot, 'dist-debug', 'src');

const originalResolveFilename = Module._resolveFilename;
// eslint-disable-next-line func-names
Module._resolveFilename = function (request, parent, isMain, options) {
  if (typeof request === 'string' && request.startsWith('@/')) {
    const mapped = path.join(distSrcRoot, request.slice(2)); // remove "@/"
    return originalResolveFilename.call(this, mapped, parent, isMain, options);
  }
  return originalResolveFilename.call(this, request, parent, isMain, options);
};

require('../dist-debug/debug/run-statement-sample.js');


