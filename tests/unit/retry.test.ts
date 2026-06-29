import { describe, expect, it, vi } from "vitest";

import { callWithRetry } from "@/lib/connectors/retry";

describe("callWithRetry", () => {
  it("retries transient failures with exponential delay", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const fn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce({ status: 500 })
      .mockResolvedValueOnce("ok");

    await expect(callWithRetry(fn, { baseDelayMs: 100, sleep, random: () => 0 })).resolves.toBe(
      "ok",
    );

    expect(fn).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(100);
  });

  it("does not retry non-retryable 4xx errors", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const error = { status: 403 };
    const fn = vi.fn<() => Promise<string>>().mockRejectedValue(error);

    await expect(callWithRetry(fn, { sleep })).rejects.toBe(error);

    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("honors retry-after for 429 responses", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const fn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce({ response: { status: 429, headers: { "retry-after": "2" } } })
      .mockResolvedValueOnce("ok");

    await expect(callWithRetry(fn, { sleep })).resolves.toBe("ok");

    expect(sleep).toHaveBeenCalledWith(2000);
  });
});
