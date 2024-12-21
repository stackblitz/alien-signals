import { Computed, ISignal } from '../index.js';

export function equalityComputed<T>(getter: () => T): ISignal<T> {
  return new EqualityComputed(getter);
}

export class EqualityComputed<T = any> extends Computed<T> {
  constructor(getter: () => T) {
    super(oldValue => {
      const newValue = getter();
      if (this.equals(oldValue, newValue)) {
        return oldValue!;
      }
      return newValue;
    });
  }

  equals(a: any, b: any): boolean {
    if (a === b) {
      return true;
    }

    if (a === null || b === null || typeof a !== typeof b) {
      return false;
    }

    if (typeof a === 'object') {
      if (Array.isArray(a) && Array.isArray(b)) {
        if (a.length !== b.length) {
          return false;
        }
        for (let i = 0; i < a.length; i++) {
          if (!this.equals(a[i], b[i])) {
            return false;
          }
        }
        return true;
      }

      if (!Array.isArray(a) && !Array.isArray(b)) {
        for (const key in a) {
          if (a.hasOwnProperty(key)) {
            if (!b.hasOwnProperty(key) || !this.equals(a[key], b[key])) {
              return false;
            }
          }
        }
        for (const key in b) {
          if (b.hasOwnProperty(key) && !a.hasOwnProperty(key)) {
            return false;
          }
        }
        return true;
      }

      return false; // One is array and the other is not
    }

    return false;
  }
}
