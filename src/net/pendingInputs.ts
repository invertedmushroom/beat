import type { PlayerInput } from '../engine/protocol';

export const PENDING_INPUT_CAPACITY = 32;
export const REDUNDANT_EVENT_INPUT_CAPACITY = 8;

export class PendingInputQueue {
  private pending: PlayerInput[] = [];
  private highestAckedSequence = 0;

  push(input: PlayerInput): void {
    if (input.sequence <= this.highestAckedSequence) {
      return;
    }
    this.pending = this.pending.filter((candidate) => candidate.sequence > this.highestAckedSequence && candidate.sequence !== input.sequence);
    this.pending.push(input);
    this.pending.sort((a, b) => a.sequence - b.sequence);
    while (this.pending.length > PENDING_INPUT_CAPACITY) {
      this.pending.shift();
    }
  }

  ackUpTo(sequence: number): void {
    if (sequence > this.highestAckedSequence) {
      this.highestAckedSequence = sequence;
    }
    this.pending = this.pending.filter((candidate) => candidate.sequence > this.highestAckedSequence);
  }

  snapshot(): PlayerInput[] {
    return this.pending.slice();
  }

  redundantEventInputs(): PlayerInput[] {
    return this.pending.filter(hasInputEvents).slice(-REDUNDANT_EVENT_INPUT_CAPACITY);
  }

  size(): number {
    return this.pending.length;
  }

  highestAcked(): number {
    return this.highestAckedSequence;
  }
}

export function hasInputEvents(input: PlayerInput): boolean {
  return input.castSlots.length > 0 || input.slotPresses.length > 0 || input.slotReleases.length > 0;
}
