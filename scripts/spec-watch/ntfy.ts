/*
 * Send a push through ntfy.sh.
 *
 * - The topic is the only thing guarding it, so it never appears in a reason
 *   or a log line.
 */
import type { Failure, Fetch } from "./github.ts";

import { describeError } from "../../src/output.ts";

/** A push that was sent. */
type Sent = {
  /**
   * Always `true` once ntfy accepted the push.
   *
   * @example true
   */
  isOk: true;
};

/** The ntfy server, which publishes a JSON message posted to its root. */
const NTFY_URL = "https://ntfy.sh/";

/** Publish one push to a topic, which opens a link when tapped. */
export async function sendPush({
  clickUrl,
  fetch,
  message,
  title,
  topic,
}: {
  /** The page the push opens, such as the new issue. */
  clickUrl: string;

  /** The `fetch` to call. */
  fetch: Fetch;

  /** The push's text. */
  message: string;

  /** The push's title. */
  title: string;

  /** The ntfy topic, which is secret. */
  topic: string;
}): Promise<Failure | Sent> {
  try {
    const response = await fetch(NTFY_URL, {
      body: JSON.stringify({
        click: clickUrl,
        message,
        tags: ["telescope"],
        title,
        topic,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });

    return response.ok
      ? { isOk: true }
      : { isOk: false, reason: `ntfy answered ${response.status}` };
  } catch (error: unknown) {
    return {
      isOk: false,
      reason: `ntfy couldn't be reached: ${describeError(error)}`,
    };
  }
}
