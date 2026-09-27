import { QueueFullError, TimeoutError, createLimiter, withTimeout } from '../../backend/utils/limiter';

function deferred<T = void>() {
  let resolve!: (v: T) => void; let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const tick = () => new Promise(r => setImmediate(r));

describe('createLimiter', () => {
  it('runs at most `max` tasks at once and starts queued ones in order', async () => {
    const limiter = createLimiter(2);
    const gates = [deferred(), deferred(), deferred(), deferred()];
    const started: number[] = [];
    const runs = gates.map((g, i) => limiter.run(async () => { started.push(i); await g.promise; return i; }));
    await tick();
    expect(started).toEqual([0, 1]);
    expect(limiter.active).toBe(2);
    expect(limiter.queued).toBe(2);
    gates[1].resolve();
    await tick();
    expect(started).toEqual([0, 1, 2]);
    gates[0].resolve(); gates[2].resolve(); gates[3].resolve();
    expect(await Promise.all(runs)).toEqual([0, 1, 2, 3]);
    expect(limiter.active).toBe(0);
  });

  it('frees the slot when a task fails (sync or async)', async () => {
    const limiter = createLimiter(1);
    await expect(limiter.run(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    await expect(limiter.run(() => { throw new Error('sync'); })).rejects.toThrow('sync');
    await expect(limiter.run(async () => 'ok')).resolves.toBe('ok');
    expect(limiter.active).toBe(0);
  });

  it('rejects with QueueFullError when the queue is full', async () => {
    const limiter = createLimiter(1, 1);
    const gate = deferred();
    const first = limiter.run(() => gate.promise);
    const second = limiter.run(async () => 2);
    await expect(limiter.run(async () => 3)).rejects.toBeInstanceOf(QueueFullError);
    gate.resolve();
    await first;
    await expect(second).resolves.toBe(2);
  });
});

describe('withTimeout', () => {
  afterEach(() => jest.useRealTimers());

  it('passes through a value in time', async () => {
    await expect(withTimeout(Promise.resolve(5), 100)).resolves.toBe(5);
  });

  it('rejects with TimeoutError when too slow', async () => {
    jest.useFakeTimers();
    const p = withTimeout(new Promise(() => {}), 25_000, 'render');
    jest.advanceTimersByTime(25_000);
    await expect(p).rejects.toBeInstanceOf(TimeoutError);
    await expect(p).rejects.toThrow('render timed out after 25000 ms');
  });

  it('passes through a rejection', async () => {
    await expect(withTimeout(Promise.reject(new Error('x')), 100)).rejects.toThrow('x');
  });
});
