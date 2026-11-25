import { describe, expect, test } from "vitest";

import { createFakeFetch } from "#test/spec-watch";

import { sendPush } from "./ntfy.ts";

/** The ntfy server's root, which every push is posted to. */
const NTFY_URL = "https://ntfy.sh/";

/** A fabricated secret topic. */
const TOPIC = "fake-topic-0123";

/** The push every test sends, given its `fetch`. */
function push(fetch: typeof globalThis.fetch): ReturnType<typeof sendPush> {
  return sendPush({
    clickUrl: "https://github.com/acme/tools/issues/7",
    fetch,
    message: "New commits to the spec. See #7.",
    title: "The upstream OKF spec changed",
    topic: TOPIC,
  });
}

describe("sendPush", () => {
  test("posts the push as JSON to the topic", async () => {
    // Given - ntfy accepts the push
    const fake = createFakeFetch([{ method: "POST", url: NTFY_URL }]);

    // When - sending it
    const answer = await push(fake.fetch);

    // Then - one JSON post with the topic, the link, and the text
    expect(answer).toStrictEqual({ isOk: true });
    expect(fake.requests).toHaveLength(1);
    expect(fake.requests[0]?.headers).toStrictEqual({
      "content-type": "application/json",
    });
    expect(JSON.parse(fake.requests[0]?.body ?? "")).toStrictEqual({
      click: "https://github.com/acme/tools/issues/7",
      message: "New commits to the spec. See #7.",
      tags: ["telescope"],
      title: "The upstream OKF spec changed",
      topic: TOPIC,
    });
  });

  test("fails with the status ntfy answered, without the topic", async () => {
    // Given - ntfy refuses the push
    const fake = createFakeFetch([
      { method: "POST", status: 429, url: NTFY_URL },
    ]);

    // When - sending it
    const answer = await push(fake.fetch);

    // Then - the status, and no topic
    expect(answer).toStrictEqual({ isOk: false, reason: "ntfy answered 429" });
  });

  test("fails when ntfy can't be reached", async () => {
    // Given - the network fails
    const fake = createFakeFetch([
      { error: new Error("socket hang up"), method: "POST", url: NTFY_URL },
    ]);

    // When - sending it
    const answer = await push(fake.fetch);

    // Then - the error's message
    expect(answer).toStrictEqual({
      isOk: false,
      reason: "ntfy couldn't be reached: socket hang up",
    });
  });
});
