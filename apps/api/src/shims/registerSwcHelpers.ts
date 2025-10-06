import * as swcHelpers from '@swc/helpers';
import { applyDecoratedDescriptor as localApplyDecoratedDescriptor } from './swcHelpers.js';

const applyDecoratedDescriptor =
  typeof swcHelpers.applyDecoratedDescriptor === 'function'
    ? swcHelpers.applyDecoratedDescriptor
    : localApplyDecoratedDescriptor;

// Best-effort: only patch if the namespace object is extensible (typically false for ESM).
if (typeof swcHelpers.applyDecoratedDescriptor !== 'function') {
  try {
    if (Object.isExtensible(swcHelpers)) {
      Object.defineProperty(swcHelpers, 'applyDecoratedDescriptor', {
        value: applyDecoratedDescriptor,
        configurable: true,
        writable: true,
      });
    }
  } catch {}
}
