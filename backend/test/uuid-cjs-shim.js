// uuid v14 ships ESM-only (both `dist` and `dist-node`), which Jest's CJS
// runtime cannot require. The codebase only uses `v4`, so map `uuid` to this
// shim in jest.config.js — node's built-in randomUUID is an RFC 4122 v4 UUID.
const { randomUUID } = require('node:crypto');

module.exports = {
  v4: () => randomUUID(),
};
