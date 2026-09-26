/**
 * Issue #805 — Print-friendly contract and event detail views & signed PDF export
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import EventPage from "../src/pages/EventPage";
import ContractPage from "../src/pages/ContractPage";
import { api } from "../src/api";

vi.mock("../src/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/api")>();
  return {
    ...original,
    api: {
      ...original.api,
      event: vi.fn(),
      contract: vi.fn(),
      contractEvents: vi.fn(),
      sourceVerifications: vi.fn(),
      migrationStatus: vi.fn(),
      circuitBreakerStatus: vi.fn(),
      quorumFreezeStatus: vi.fn(),
      rwaMetadata: vi.fn(),
      abiHistory: vi.fn(),
    },
  };
});

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/test"]}>
        {ui}
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("Print & PDF Reports Views (Issue #805)", () => {
  const printSpy = vi.fn();

  beforeEach(() => {
    window.print = printSpy;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("EventPage renders Print View and Export PDF buttons and triggers window.print", async () => {
    vi.mocked(api.event).mockResolvedValue({
      seq: 1042,
      ledger: 500000,
      contract_id: "CAAA1111222233334444555566667777888899990000AAAABBBBCCCCDD",
      function: "transfer",
      description: "Transfer tokens",
      raw_topics: [],
      is_reorg: false,
    } as any);

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/event/1042"]}>
          <Routes>
            <Route path="/event/:seq" element={<EventPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );

    const printBtn = await screen.findByRole("button", { name: /print view/i });
    expect(printBtn).toBeInTheDocument();

    const exportLink = screen.getByRole("link", { name: /export signed pdf/i });
    expect(exportLink).toBeInTheDocument();
    expect(exportLink).toHaveAttribute("href", "/api/reports/event/1042");

    // Click print button
    fireEvent.click(printBtn);
    expect(printSpy).toHaveBeenCalled();

    // Check print header & footer exist in DOM
    expect(document.querySelector(".print-header")).toBeInTheDocument();
    expect(document.querySelector(".print-footer")).toBeInTheDocument();
  });

  it("EventPage displays reorg watermark banner for superseded events", async () => {
    vi.mocked(api.event).mockResolvedValue({
      seq: 1045,
      ledger: 500001,
      contract_id: "CAAA1111222233334444555566667777888899990000AAAABBBBCCCCDD",
      function: "transfer",
      description: "Superseded transfer",
      raw_topics: [],
      is_reorg: true,
    } as any);

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/event/1045"]}>
          <Routes>
            <Route path="/event/:seq" element={<EventPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );

    const reorgBanner = await screen.findByText(/SUPERSEDED BY REORG/i);
    expect(reorgBanner).toBeInTheDocument();
  });

  it("ContractPage renders Print View and Export Signed PDF buttons", async () => {
    const contractId = "CCONTRACT1111222233334444555566667777888899990000AAAABBBBCCCC";
    vi.mocked(api.contract).mockResolvedValue({
      id: contractId,
      name: "Stellar Liquidity Pool",
      description: "Automated market maker",
      functions: [{ name: "deposit", description: "Deposit", params: [] }],
      registered_by: "GADMIN1111",
      min_ledger: 100000,
      protocol_type: "dex",
    } as any);
    vi.mocked(api.contractEvents).mockResolvedValue({ events: [], total: 0 } as any);
    vi.mocked(api.sourceVerifications).mockResolvedValue([]);

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/contract/" + contractId]}>
          <Routes>
            <Route path="/contract/:id" element={<ContractPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );

    const printBtn = await screen.findByRole("button", { name: /print view/i });
    expect(printBtn).toBeInTheDocument();

    const exportLink = screen.getByRole("link", { name: /export signed pdf/i });
    expect(exportLink).toBeInTheDocument();
    expect(exportLink).toHaveAttribute("href", "/api/reports/contract/" + contractId);

    // Click print button
    fireEvent.click(printBtn);
    expect(printSpy).toHaveBeenCalled();

    // Check print header & footer exist in DOM
    expect(document.querySelector(".print-header")).toBeInTheDocument();
    expect(document.querySelector(".print-footer")).toBeInTheDocument();
  });
});
