export type Unsubscribe = () => void;

type EventArgs<TEvents, K extends keyof TEvents> = TEvents[K] extends (...args: infer TArgs) => void
  ? TArgs
  : never;

type EventCallback<TEvents, K extends keyof TEvents> = TEvents[K] extends (...args: infer TArgs) => void
  ? (...args: TArgs) => void
  : never;

export type Emitter<TEvents extends object> = {
  emit<K extends keyof TEvents>(event: K, ...args: EventArgs<TEvents, K>): void;
  on<K extends keyof TEvents>(event: K, cb: EventCallback<TEvents, K>): Unsubscribe;
};

export function createNanoEvents<TEvents extends object>(): Emitter<TEvents> {
  const listeners = new Map<keyof TEvents, Set<(...args: any[]) => void>>();

  return {
    emit(event, ...args) {
      const handlers = listeners.get(event);
      if (!handlers) return;
      for (const handler of handlers) {
        handler(...args);
      }
    },
    on(event, cb) {
      const handlers = listeners.get(event) ?? new Set<(...args: any[]) => void>();
      handlers.add(cb);
      listeners.set(event, handlers);
      return () => {
        const current = listeners.get(event);
        if (!current) return;
        current.delete(cb);
        if (current.size === 0) {
          listeners.delete(event);
        }
      };
    },
  };
}
