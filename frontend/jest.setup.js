// jsdom (the jest test environment) does not implement TextEncoder/TextDecoder,
// but @stellar/stellar-sdk requires them at import time. Polyfill from Node's
// built-in `util` module before any test file loads.
const { TextEncoder, TextDecoder } = require('util');

if (typeof global.TextEncoder === 'undefined') {
  global.TextEncoder = TextEncoder;
}
if (typeof global.TextDecoder === 'undefined') {
  global.TextDecoder = TextDecoder;
}

// jsdom also does not implement window.matchMedia, used by useMediaQuery
// (and anything that renders responsive components under test).
if (typeof window !== 'undefined' && typeof window.matchMedia === 'undefined') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {}, // deprecated, some libs still call it
      removeListener: () => {}, // deprecated
      dispatchEvent: () => false,
    }),
  });
}
