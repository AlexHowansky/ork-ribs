import type { Logger } from "./log.ts";

/**
 * An error whose `message` is safe and friendly enough to show to the reader.
 * Anything that is not an AppError is reported to the client as a generic
 * failure; its details only ever reach the server log.
 */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const Errors = {
  badRequest: (message: string) => new AppError(400, "bad_request", message),
  notFound: (message = "We couldn't find what you were looking for.") => new AppError(404, "not_found", message),
  tooLarge: () => new AppError(413, "too_large", "That request was too large."),
  rateLimited: () =>
    new AppError(429, "rate_limited", "You're moving a little fast for us. Please wait a moment and try again."),
  unavailable: (message = "Restaurant data isn't available yet. Please try again in a minute.") =>
    new AppError(503, "unavailable", message),
};

export function errorResponse(err: unknown, logger: Logger, headers?: HeadersInit): Response {
  if (err instanceof AppError) {
    if (err.status >= 500) logger.warn("request failed", { status: err.status, code: err.code });
    return Response.json({ error: { code: err.code, message: err.message } }, { status: err.status, headers });
  }
  logger.error("unhandled error", { err });
  return Response.json(
    { error: { code: "internal", message: "Something went wrong on our end. Please try again in a moment." } },
    { status: 500, headers },
  );
}
