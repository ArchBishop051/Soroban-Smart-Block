import { test, expect, Page, request } from "@playwright/test";

// Multi-client collaborative sandbox test (#926): two browsers edit the same
// shared session concurrently, converge, and survive a disconnect/reconnect.

const BASE_URL = process.env.FRONTEND_URL || "http://localhost:5173";
const API_URL = process.env.API_URL || "http://localhost:3001";

async function editorText(page: Page): Promise<string> {
  return (await page.locator('[data-testid="collab-editor"] .view-lines').innerText()).replace(/ /g, " ");
}

async function typeAtEnd(page: Page, text: string): Promise<void> {
  await page.locator('[data-testid="collab-editor"] .view-lines').click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(text);
}

test("two browsers edit a shared sandbox concurrently and converge", async ({ browser }) => {
  test.setTimeout(180_000);
  const api = await request.newContext({ baseURL: API_URL });
  const sandboxId = `collab-e2e-${Date.now()}`;
  const saved = await api.post("/api/sandbox", {
    data: {
      sandboxId,
      templateId: "node-sdk",
      files: { "index.js": { path: "index.js", content: "// shared\n", language: "javascript" } },
    },
  });
  expect(saved.ok()).toBeTruthy();
  const session = await (await api.post("/api/collab/sessions", { data: { sandboxId } })).json();
  const url = (token: string) => `${BASE_URL}/sandbox/${sandboxId}?session=${session.sessionId}&token=${token}`;

  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();
  await a.goto(url(session.ownerToken));
  await b.goto(url(session.editToken));
  for (const p of [a, b]) {
    await expect(p.getByTestId("collab-status")).toHaveText("connected");
    await expect(p.locator('[data-testid="collab-editor"] .view-lines')).toContainText("// shared");
  }

  // Presence: each side sees two participants.
  await expect(a.getByTestId("collab-participants").locator("div", { hasText: "●" })).toHaveCount(2);

  // Concurrent edits.
  await Promise.all([typeAtEnd(a, "const fromA = 1;"), typeAtEnd(b, "const fromB = 2;")]);
  await expect.poll(async () => (await editorText(a)) === (await editorText(b))).toBe(true);
  for (const p of [a, b]) {
    await expect(p.locator('[data-testid="collab-editor"] .view-lines')).toContainText("fromA");
    await expect(p.locator('[data-testid="collab-editor"] .view-lines')).toContainText("fromB");
  }

  // B goes offline, both keep editing, B reconnects: offline edits merge.
  await ctxB.setOffline(true);
  // y-websocket notices a dead socket after its 30s heartbeat timeout.
  await expect(b.getByTestId("collab-status")).not.toHaveText("connected", { timeout: 45_000 });
  await typeAtEnd(b, "offlineB");
  await typeAtEnd(a, "onlineA");
  await ctxB.setOffline(false);
  await expect(b.getByTestId("collab-status")).toHaveText("connected", { timeout: 30_000 });
  await expect.poll(async () => (await editorText(a)) === (await editorText(b)), { timeout: 30_000 }).toBe(true);
  for (const p of [a, b]) {
    await expect(p.locator('[data-testid="collab-editor"] .view-lines')).toContainText("offlineB");
    await expect(p.locator('[data-testid="collab-editor"] .view-lines')).toContainText("onlineA");
  }

  await ctxA.close();
  await ctxB.close();
  await api.dispose();
});
