/**
 * A minimal Prometheus text-format registry.
 *
 * The ingest service is the one deployable whose dependency surface is deliberately tiny —
 * Postgres and a secret cache — because it is the endpoint that must never be down. A metrics
 * library would add a dependency for four counters and a histogram.
 */
type Labels = Record<string, string>;

function labelKey(labels: Labels): string {
  const entries = Object.entries(labels).sort(([a], [b]) => (a < b ? -1 : 1));
  return entries.map(([k, v]) => `${k}="${v.replace(/"/g, '')}"`).join(',');
}

class Counter {
  readonly name: string;
  readonly help: string;
  private readonly values = new Map<string, number>();

  constructor(name: string, help: string) {
    this.name = name;
    this.help = help;
  }

  inc(labels: Labels = {}, by = 1): void {
    const key = labelKey(labels);
    this.values.set(key, (this.values.get(key) ?? 0) + by);
  }

  render(): string {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} counter`];
    for (const [key, value] of this.values) {
      lines.push(key ? `${this.name}{${key}} ${value}` : `${this.name} ${value}`);
    }
    return lines.join('\n');
  }
}

class Histogram {
  readonly name: string;
  readonly help: string;
  private readonly buckets: number[];
  private readonly counts = new Map<string, { bucketCounts: number[]; sum: number; count: number }>();

  constructor(name: string, help: string, buckets: number[]) {
    this.name = name;
    this.help = help;
    this.buckets = buckets;
  }

  observe(seconds: number, labels: Labels = {}): void {
    const key = labelKey(labels);
    const entry = this.counts.get(key) ?? {
      bucketCounts: new Array<number>(this.buckets.length).fill(0),
      sum: 0,
      count: 0,
    };

    for (const [index, bound] of this.buckets.entries()) {
      if (seconds <= bound) entry.bucketCounts[index] = (entry.bucketCounts[index] ?? 0) + 1;
    }
    entry.sum += seconds;
    entry.count += 1;
    this.counts.set(key, entry);
  }

  render(): string {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} histogram`];
    for (const [key, entry] of this.counts) {
      const prefix = key ? `${key},` : '';
      for (const [index, bound] of this.buckets.entries()) {
        lines.push(`${this.name}_bucket{${prefix}le="${bound}"} ${entry.bucketCounts[index] ?? 0}`);
      }
      lines.push(`${this.name}_bucket{${prefix}le="+Inf"} ${entry.count}`);
      lines.push(key ? `${this.name}_sum{${key}} ${entry.sum}` : `${this.name}_sum ${entry.sum}`);
      lines.push(key ? `${this.name}_count{${key}} ${entry.count}` : `${this.name}_count ${entry.count}`);
    }
    return lines.join('\n');
  }
}

export const metrics = {
  webhookReceived: new Counter('webhook_received_total', 'Webhooks accepted after signature verification.'),
  webhookRejected: new Counter('webhook_rejected_total', 'Webhooks rejected, labelled by reason.'),
  signatureFailures: new Counter('webhook_signature_failures_total', 'Signature verifications that failed.'),
  eventsPersisted: new Counter('events_persisted_total', 'Events written to the immutable log.'),
  duplicatesIgnored: new Counter('events_duplicate_total', 'Repeat deliveries that were a no-op.'),
  ackSeconds: new Histogram('webhook_ack_seconds', 'Time to acknowledge a webhook.', [
    0.01, 0.025, 0.05, 0.1, 0.15, 0.3, 0.5, 1, 2,
  ]),
};

export function renderMetrics(): string {
  return `${[
    metrics.webhookReceived,
    metrics.webhookRejected,
    metrics.signatureFailures,
    metrics.eventsPersisted,
    metrics.duplicatesIgnored,
    metrics.ackSeconds,
  ]
    .map((m) => m.render())
    .join('\n\n')}\n`;
}
