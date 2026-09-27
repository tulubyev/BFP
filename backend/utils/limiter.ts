/**
 * Concurrency limit with a bounded queue, plus a promise timeout. Used for CPU/network-heavy work
 * such as rendering satellite images, so a burst of requests cannot exhaust the server.
 */

export class TimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`${label} timed out after ${ms} ms`);
    this.name = 'TimeoutError';
  }
}

export class QueueFullError extends Error {
  constructor() {
    super('Too many requests waiting');
    this.name = 'QueueFullError';
  }
}

/** Rejects with TimeoutError after `ms`; the underlying work is not cancelled. */
export function withTimeout<T>(promise: Promise<T>, ms: number, label = 'operation'): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(label, ms)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export interface Limiter {
  /** Runs `task` when one of `max` slots is free; rejects with QueueFullError when the queue is full. */
  run<T>(task: () => Promise<T>): Promise<T>;
  readonly active: number;
  readonly queued: number;
}

export function createLimiter(max: number, maxQueue = Infinity): Limiter {
  let active = 0;
  const queue: (() => void)[] = [];

  const release = () => {
    active--;
    const next = queue.shift();
    if (next) next();
  };

  return {
    run<T>(task: () => Promise<T>): Promise<T> {
      const start = () => {
        active++;
        let result: Promise<T>;
        try {
          result = task();
        } catch (err) {
          result = Promise.reject(err);
        }
        return result.finally(release);
      };
      if (active < max) return start();
      if (queue.length >= maxQueue) return Promise.reject(new QueueFullError());
      return new Promise<T>((resolve, reject) => {
        queue.push(() => { start().then(resolve, reject); });
      });
    },
    get active() { return active; },
    get queued() { return queue.length; },
  };
}
