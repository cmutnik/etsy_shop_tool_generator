// Copyright (c) 2025 cmutnik
// Undo / redo of the page's settings. Pure and dependency-free: it stores the states it is given, each with a `key` (a string that
// is equal exactly when two states are the same), so recording an unchanged state does nothing.

export function createHistory(limit = 100) {
  let stack = [], index = -1;
  return {
    /** Start over with one state (a new file was opened). */
    reset(state, key) { stack = [{ state, key }]; index = 0; },
    /** Record a state. Returns false (and records nothing) if it equals the current one. Anything that could be redone is dropped. */
    push(state, key) {
      if (index >= 0 && stack[index].key === key) return false;
      stack.length = index + 1;
      stack.push({ state, key });
      if (stack.length > limit) stack.shift();
      index = stack.length - 1;
      return true;
    },
    /** The previous state, or null at the start. */
    undo() { if (index <= 0) return null; index--; return stack[index].state; },
    /** The next state, or null at the end. */
    redo() { if (index >= stack.length - 1) return null; index++; return stack[index].state; },
    get canUndo() { return index > 0; },
    get canRedo() { return index >= 0 && index < stack.length - 1; },
    get size() { return stack.length; },
  };
}
