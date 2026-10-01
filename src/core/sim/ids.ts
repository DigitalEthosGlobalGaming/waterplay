import type { EntityId } from '../interfaces/common.ts';
import type { PeerId } from '../interfaces/transport.ts';

/** Generates `${peerId}:${counter}` ids, unique across peers (§4.2). */
export class EntityIdAllocator {
  constructor(
    private readonly peer: PeerId,
    private counter = 0,
  ) {}

  next(): EntityId {
    this.counter += 1;
    return `${this.peer}:${this.counter}`;
  }

  get state(): number {
    return this.counter;
  }
}
