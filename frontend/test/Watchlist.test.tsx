import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import App from "../src/App";

describe("Watchlist", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("stores starred wallets/contracts and shows them in the watchlist view", async () => {
    render(
      <MemoryRouter initialEntries={["/contract/CA123"]}>
        <Routes>
          <Route path="/contract/:id" element={<App />} />
          <Route path="/watchlist" element={<App />} />
        </Routes>
      </MemoryRouter>,
    );

    const starButton = screen.getByRole("button", { name: /watchlist/i });
    fireEvent.click(starButton);

    expect(JSON.parse(localStorage.getItem("watchlist") || "[]")).toContain("CA123");

    render(
      <MemoryRouter initialEntries={["/watchlist"]}>
        <Routes>
          <Route path="/watchlist" element={<App />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText(/watchlist/i)).toBeInTheDocument();
  });
});
