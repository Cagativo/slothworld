import { getRawEvents } from './eventStore.js';
import { deriveWorldState } from './deriveWorldState.js';

export function getIndexedWorldSnapshot() {
  return deriveWorldState(getRawEvents());
}
