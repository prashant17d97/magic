/**
 * Job identity for the queue.
 *
 * A job id is what makes an at-least-once delivery safe: publishing the same id twice updates one
 * job rather than running the work twice. BullMQ stores it inside a Redis key and so rejects any
 * id containing a colon, which is why the parts are joined with a separator that cannot appear in
 * a tenant id, a Stripe object id, or a queue name.
 */
const SEPARATOR = '~';

export function jobIdOf(...parts: readonly (string | number)[]): string {
  return parts.map((part) => String(part).replaceAll(':', SEPARATOR)).join(SEPARATOR);
}
