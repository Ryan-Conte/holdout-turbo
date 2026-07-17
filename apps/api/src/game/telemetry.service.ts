import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { DbService, type TelemetryEventWrite } from '../db/db.service';

export type EconomyEventKind =
  | 'extraction'
  | 'currency_spawned'
  | 'currency_destroyed'
  | 'item_spawned'
  | 'item_destroyed'
  | 'bot_contribution'
  | 'profile_save_failed'
  | 'profile_lease_conflict'
  | 'admin_action';

export interface EconomyEvent {
  kind: EconomyEventKind;
  userId?: string;
  itemId?: string;
  quantity?: number;
  credits?: number;
  value?: number;
  source?: string;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class TelemetryService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Telemetry');
  private readonly queue: TelemetryEventWrite[] = [];
  private readonly totals: Record<string, number> = {};
  private flushTimer: NodeJS.Timeout;
  private flushFailures = 0;
  private droppedEvents = 0;
  private flushing = false;

  constructor(private readonly db: DbService) {}

  onModuleInit() {
    this.flushTimer = setInterval(() => void this.flush(), 10_000);
  }

  async onModuleDestroy() {
    clearInterval(this.flushTimer);
    await this.flush();
  }

  record(event: EconomyEvent) {
    const quantity = Math.max(0, Math.floor(Number(event.quantity) || 0));
    const credits = Math.max(0, Math.floor(Number(event.credits) || 0));
    const value = Math.max(0, Math.floor(Number(event.value) || 0));
    this.totals[`${event.kind}.events`] = (this.totals[`${event.kind}.events`] ?? 0) + 1;
    this.totals[`${event.kind}.quantity`] = (this.totals[`${event.kind}.quantity`] ?? 0) + quantity;
    this.totals[`${event.kind}.credits`] = (this.totals[`${event.kind}.credits`] ?? 0) + credits;
    this.totals[`${event.kind}.value`] = (this.totals[`${event.kind}.value`] ?? 0) + value;
    if (this.queue.length >= 10_000) {
      this.queue.shift();
      this.droppedEvents++;
    }
    this.queue.push({
      kind: event.kind,
      userId: event.userId,
      itemId: event.itemId,
      quantity,
      credits,
      value,
      source: event.source,
      metadata: event.metadata,
    });
  }

  snapshot() {
    return {
      queued: this.queue.length,
      flushFailures: this.flushFailures,
      droppedEvents: this.droppedEvents,
      totals: { ...this.totals },
    };
  }

  async flush() {
    if (this.flushing || this.queue.length === 0) return;
    this.flushing = true;
    const batch = this.queue.splice(0, 1000);
    try {
      if (!await this.db.writeTelemetryEvents(batch)) {
        this.flushFailures++;
        this.queue.unshift(...batch);
      }
    } catch (error) {
      this.flushFailures++;
      this.queue.unshift(...batch);
      this.log.error(`Telemetry flush failed: ${(error as Error).message}`);
    } finally {
      this.flushing = false;
    }
  }
}
