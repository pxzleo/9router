import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/usageDb", () => ({ getRequestDetails: vi.fn() }));

import { getRequestDetails } from "@/lib/usageDb";
import { GET } from "@/app/api/usage/request-details/route.js";

describe("request details API", () => {
  it("returns the stored request and response content to the details view", async () => {
    const detail = {
      id: "detail-1",
      request: { messages: [{ role: "user", content: "example prompt" }] },
      providerRequest: { messages: [{ role: "user", content: "example prompt" }] },
      providerResponse: { choices: [{ message: { content: "example answer" } }] },
      response: { content: "example answer", thinking: "example reasoning" },
    };
    getRequestDetails.mockResolvedValue({
      details: [detail],
      pagination: { page: 1, pageSize: 20, totalItems: 1 },
    });

    const response = await GET(new Request("http://localhost/api/usage/request-details"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.details).toEqual([detail]);
    expect(body.pagination.totalItems).toBe(1);
  });
});
