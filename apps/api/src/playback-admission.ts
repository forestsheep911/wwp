import { randomUUID } from "node:crypto";
import type {
  PlaybackAdmissionResponse,
  PlaybackCapacity,
  PlaybackLine,
  PlaybackLoadLevel
} from "@wwpdw/shared";

type AdmissionStatus = PlaybackAdmissionResponse["status"];

export function playbackRequiresLocalAdmission(line: PlaybackLine, localMediaEnabled: boolean) {
  return localMediaEnabled && line !== "domestic";
}

interface AdmissionTicket {
  id: string;
  sessionId: string;
  assetKey: string;
  title: string;
  status: AdmissionStatus;
  createdAt: number;
  lastSeenAt: number;
}

interface PlaybackAdmissionQueueOptions {
  now?: () => number;
  createId?: () => string;
  queuedLeaseMs?: number;
  admittedLeaseMs?: number;
}

export function playbackLoadLevel(active: number, maximum: number): PlaybackLoadLevel {
  if (active >= maximum) return "full";
  const ratio = active / maximum;
  if (ratio >= 0.75) return "high";
  if (ratio >= 0.375) return "medium";
  return "low";
}

export class PlaybackAdmissionQueue {
  private readonly tickets = new Map<string, AdmissionTicket>();
  private readonly now: () => number;
  private readonly createId: () => string;
  private readonly queuedLeaseMs: number;
  private readonly admittedLeaseMs: number;

  constructor(
    private readonly maximum: number,
    options: PlaybackAdmissionQueueOptions = {}
  ) {
    this.now = options.now ?? Date.now;
    this.createId = options.createId ?? randomUUID;
    this.queuedLeaseMs = options.queuedLeaseMs ?? 30_000;
    this.admittedLeaseMs = options.admittedLeaseMs ?? 90_000;
  }

  capacity(): PlaybackCapacity {
    this.cleanup();
    const active = this.activeTickets().length;
    const queued = this.queuedTickets().length;
    return {
      enabled: true,
      active,
      maximum: this.maximum,
      queued,
      level: playbackLoadLevel(active, this.maximum)
    };
  }

  request(input: {
    sessionId: string;
    assetKey: string;
    title: string;
    ticketId?: string;
  }): PlaybackAdmissionResponse | undefined {
    this.cleanup();
    const now = this.now();
    let ticket: AdmissionTicket | undefined;

    if (input.ticketId) {
      const existing = this.tickets.get(input.ticketId);
      if (
        !existing
        || existing.sessionId !== input.sessionId
        || existing.assetKey !== input.assetKey
      ) {
        return undefined;
      }
      existing.lastSeenAt = now;
      ticket = existing;
    } else {
      ticket = {
        id: this.createId(),
        sessionId: input.sessionId,
        assetKey: input.assetKey,
        title: input.title,
        status: this.activeTickets().length < this.maximum ? "admitted" : "queued",
        createdAt: now,
        lastSeenAt: now
      };
      this.tickets.set(ticket.id, ticket);
    }

    this.promote();
    return this.response(ticket);
  }

  release(ticketId: string, sessionId: string) {
    const ticket = this.tickets.get(ticketId);
    if (!ticket || ticket.sessionId !== sessionId) {
      return false;
    }
    this.tickets.delete(ticketId);
    this.promote();
    return true;
  }

  admitted(ticketId: string | undefined, sessionId: string, assetKey: string) {
    if (!ticketId) return false;
    this.cleanup();
    const ticket = this.tickets.get(ticketId);
    if (
      !ticket
      || ticket.status !== "admitted"
      || ticket.sessionId !== sessionId
      || ticket.assetKey !== assetKey
    ) {
      return false;
    }
    ticket.lastSeenAt = this.now();
    return true;
  }

  private response(ticket: AdmissionTicket): PlaybackAdmissionResponse {
    const queued = this.queuedTickets();
    const leaseMs = ticket.status === "admitted" ? this.admittedLeaseMs : this.queuedLeaseMs;
    return {
      assetKey: ticket.assetKey,
      title: ticket.title,
      status: ticket.status,
      ticketId: ticket.id,
      position: ticket.status === "queued"
        ? queued.findIndex((candidate) => candidate.id === ticket.id) + 1
        : undefined,
      leaseExpiresAt: new Date(ticket.lastSeenAt + leaseMs).toISOString(),
      capacity: this.capacity()
    };
  }

  private activeTickets() {
    return [...this.tickets.values()].filter((ticket) => ticket.status === "admitted");
  }

  private queuedTickets() {
    return [...this.tickets.values()]
      .filter((ticket) => ticket.status === "queued")
      .sort((left, right) => left.createdAt - right.createdAt);
  }

  private promote() {
    let available = this.maximum - this.activeTickets().length;
    if (available <= 0) return;
    const now = this.now();
    for (const ticket of this.queuedTickets()) {
      if (available <= 0) break;
      ticket.status = "admitted";
      ticket.lastSeenAt = now;
      available -= 1;
    }
  }

  private cleanup() {
    const now = this.now();
    let removed = false;
    for (const ticket of this.tickets.values()) {
      const leaseMs = ticket.status === "admitted" ? this.admittedLeaseMs : this.queuedLeaseMs;
      if (now - ticket.lastSeenAt >= leaseMs) {
        this.tickets.delete(ticket.id);
        removed = true;
      }
    }
    if (removed) {
      this.promote();
    }
  }
}
