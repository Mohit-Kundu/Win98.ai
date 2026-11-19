/** Maximum number of undo steps Paint keeps (requirement: at least 50). */
export const HISTORY_CAPACITY = 100;

/**
 * Linear undo/redo history of immutable snapshots. Pure and framework-free.
 * Holds the current state plus up to `capacity` earlier states.
 */
export class HistoryStack<T> {
  private states: T[];
  private index = 0;

  constructor(
    initial: T,
    readonly capacity: number = HISTORY_CAPACITY,
  ) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new RangeError('capacity must be a positive integer');
    this.states = [initial];
  }

  get current(): T {
    return this.states[this.index] as T;
  }
  get canUndo(): boolean {
    return this.index > 0;
  }
  get canRedo(): boolean {
    return this.index < this.states.length - 1;
  }
  /** Number of undo steps currently available. */
  get undoDepth(): number {
    return this.index;
  }

  /** Record a new state. Drops any redo states and the oldest state beyond capacity. */
  push(state: T): void {
    this.states = this.states.slice(0, this.index + 1);
    this.states.push(state);
    if (this.states.length > this.capacity + 1) this.states.shift();
    this.index = this.states.length - 1;
  }

  /** Step back. Returns the state to restore, or undefined when nothing to undo. */
  undo(): T | undefined {
    if (!this.canUndo) return undefined;
    this.index--;
    return this.current;
  }

  /** Step forward. Returns the state to restore, or undefined when nothing to redo. */
  redo(): T | undefined {
    if (!this.canRedo) return undefined;
    this.index++;
    return this.current;
  }

  /** Start over from a single state (used after opening or clearing). */
  reset(initial: T): void {
    this.states = [initial];
    this.index = 0;
  }
}
