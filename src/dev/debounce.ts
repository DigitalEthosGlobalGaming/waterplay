export interface Debounced<T> {
  (value: T): void;
  /** True while a call is waiting to fire. */
  readonly pending: boolean;
  cancel(): void;
}

/** Calls `fn` with the latest value once no new call has arrived for `ms`. */
export function debounce<T>(ms: number, fn: (value: T) => void): Debounced<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const call = (value: T) => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      fn(value);
    }, ms);
  };
  Object.defineProperty(call, 'pending', { get: () => timer !== undefined });
  return Object.assign(call, {
    cancel: () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    },
  }) as Debounced<T>;
}
