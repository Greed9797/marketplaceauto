import { describe, expect, test, vi } from "vitest";

import { MercadoLivreClient } from "@/lib/connectors/mercado-livre/client";

function jsonResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    headers: new Headers(),
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

describe("MercadoLivreClient.fetchDailyVisits", () => {
  test("maps results[] to {date (YYYY-MM-DD), total}", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        total_visits: 390,
        results: [
          { date: "2026-06-30T00:00:00.000-03:00", total: 180 },
          { date: "2026-07-01T00:00:00.000-03:00", total: 210 },
        ],
      }),
    );
    const client = new MercadoLivreClient({ fetchImpl });
    const rows = await client.fetchDailyVisits({
      sellerId: "123",
      accessToken: "tok",
      endingDate: "2026-07-01",
      lastDays: 2,
    });
    expect(rows).toEqual([
      { date: "2026-06-30", total: 180 },
      { date: "2026-07-01", total: 210 },
    ]);
    // single call for a <=150 day window
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const url = String((fetchImpl.mock.calls[0] as unknown[])?.[0]);
    expect(url).toContain("/users/123/items_visits/time_window");
    expect(url).toContain("unit=day");
    expect(url).toContain("last=2");
    expect(url).toContain("ending=2026-07-01");
  });

  test("empty results returns [] without looping", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ results: [] }));
    const client = new MercadoLivreClient({ fetchImpl });
    const rows = await client.fetchDailyVisits({
      sellerId: "9",
      accessToken: "t",
      endingDate: "2026-07-01",
      lastDays: 400,
    });
    expect(rows).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
