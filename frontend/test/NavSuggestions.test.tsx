import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Nav from "../src/components/Nav";

describe("Nav search suggestions", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("debounces and renders suggestions from the search API", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        query: "tkn",
        contracts: [],
        events: [],
        wallets: [],
        suggestions: [
          { kind: "contract", label: "Token Contract", route: "/contract/123", meta: {} },
          { kind: "wallet", label: "GB123...", route: "/wallet/GB123", meta: {} },
        ],
      }),
    });

    global.fetch = fetchMock as unknown as typeof fetch;

    render(
      <MemoryRouter>
        <Nav />
      </MemoryRouter>,
    );

    const input = screen.getByPlaceholderText(/search contracts, events, wallets/i);
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "tkn" } });

    vi.advanceTimersByTime(250);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/search?q=tkn&limit=5"));
    });

    await waitFor(() => {
      expect(screen.getByText("Token Contract")).toBeInTheDocument();
    });
  });
});
