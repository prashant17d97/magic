import Stripe from 'stripe';

export class WebhookVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebhookVerificationError';
  }
}

export interface VerifyOptions {
  readonly rawBody: Buffer | string;
  readonly signature: string;
  readonly secret: string;
  readonly previousSecret?: string | undefined;
  readonly toleranceSeconds?: number;
}

/**
 * Verification runs against the raw body. Parsing JSON before verifying invalidates the signature
 * and is the single most common Stripe integration bug — it is a correctness failure and a
 * security failure at the same time.
 *
 * Stripe cannot switch signing secrets atomically, so rotation keeps both live for a window and
 * the previous secret is tried second.
 */
export function verifyWebhook(options: VerifyOptions): Stripe.Event {
  const tolerance = options.toleranceSeconds ?? 300;

  try {
    return Stripe.webhooks.constructEvent(options.rawBody, options.signature, options.secret, tolerance);
  } catch (primaryError) {
    if (options.previousSecret) {
      try {
        return Stripe.webhooks.constructEvent(
          options.rawBody,
          options.signature,
          options.previousSecret,
          tolerance,
        );
      } catch {
        throw new WebhookVerificationError('Signature did not verify against the current or previous secret.');
      }
    }
    throw new WebhookVerificationError(
      primaryError instanceof Error ? primaryError.message : 'Signature verification failed.',
    );
  }
}

/** Extracts the object identity from an event so the worker can debounce and re-fetch by it. */
export function eventObjectRef(event: Stripe.Event): { objectId: string | null; objectType: string | null } {
  const object = event.data.object as { id?: string; object?: string } | undefined;
  return {
    objectId: typeof object?.id === 'string' ? object.id : null,
    objectType: typeof object?.object === 'string' ? object.object : null,
  };
}
