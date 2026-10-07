/**
 * True when a write lost a unique check on `field`.
 *
 * The platform throws two shapes for this: a validation failure has the errors
 * map as the body (`{item_id: {code: "UNIQUE"}}`), while a plain non-2xx
 * response nests the same map under `errors`. Both are unwrapped here.
 *
 * `unique` is a read-then-write check on the server, not a database index, so
 * this collapses duplicate event deliveries but is not a mutex.
 */
export function isUniqueViolation(err: unknown, field: string): boolean {
  const body = (err as SwellError)?.body;

  if (!body || typeof body !== "object") {
    return false;
  }

  const errors = (body as Record<string, any>).errors ?? body;

  return errors?.[field]?.code === "UNIQUE";
}
