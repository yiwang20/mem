import { EventEmitter } from 'node:events';
import type { MindFlowEventName, MindFlowEvents } from '../types/index.js';

export class EventBus {
  private readonly emitter = new EventEmitter();

  constructor() {
    // Increase max listeners to accommodate multiple subscribers per event
    this.emitter.setMaxListeners(50);
  }

  on<K extends MindFlowEventName>(
    event: K,
    handler: (data: MindFlowEvents[K]) => void | Promise<void>,
  ): void {
    this.emitter.on(event, handler as (...args: unknown[]) => void);
  }

  off<K extends MindFlowEventName>(
    event: K,
    handler: (data: MindFlowEvents[K]) => void | Promise<void>,
  ): void {
    this.emitter.off(event, handler as (...args: unknown[]) => void);
  }

  once<K extends MindFlowEventName>(
    event: K,
    handler: (data: MindFlowEvents[K]) => void | Promise<void>,
  ): void {
    this.emitter.once(event, handler as (...args: unknown[]) => void);
  }

  emit<K extends MindFlowEventName>(event: K, data: MindFlowEvents[K]): void {
    this.emitter.emit(event, data);
  }
}
