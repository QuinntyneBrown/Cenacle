import { expect, test } from "@playwright/test";

test("Chrome exploratory smoke has no uncaught runtime errors", async ({
  page,
}) => {
  const runtimeErrors: string[] = [];
  page.on("pageerror", (error) => runtimeErrors.push(`page: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") runtimeErrors.push(`console: ${message.text()}`);
  });

  await page.addInitScript(() => {
    class LocalLanguageModel {
      static availability = async () => "available";
      static create = async () => ({
        prompt: async () =>
          "Perhaps this grief may be asking for patient attention. The last word remains yours.",
        destroy: () => undefined,
      });
    }
    Object.defineProperty(window, "LanguageModel", {
      configurable: true,
      value: LocalLanguageModel,
    });
    if (!("gpu" in navigator)) {
      Object.defineProperty(navigator, "gpu", {
        configurable: true,
        value: { requestAdapter: async () => ({}) },
      });
    }
  });

  await page.route("https://localhost:4433/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/api/telemetry") {
      await route.fulfill({ status: 204, body: "" });
      return;
    }
    if (url.pathname === "/api/rooms/ABC234" && request.method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          code: "ABC234",
          name: "Evening prayer",
          participantCount: 1,
          capacity: 12,
          expiresAt: Date.now() + 60_000,
        }),
      });
      return;
    }
    await route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });

  for (const path of [
    "/",
    "/host",
    "/join",
    "/settings",
    "/support",
    "/word/scripture",
    "/word/journal",
    "/room/ABC234",
    "/not-a-page",
  ]) {
    await page.goto(path);
    await page.waitForFunction(() => Boolean(document.querySelector("main")));
    await page.evaluate(() => document.fonts.ready);
  }

  await page.goto("/join");
  await page.getByLabel("Room code or invite link").fill("abc");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await page.getByLabel("Room code or invite link").fill("ABC234");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/r\/ABC234$/);
  await expect(page.getByRole("dialog", { name: "Camera and microphone permission" })).toBeVisible();

  await page.goto("/settings");
  await page.getByRole("radio", { name: "VP9" }).click();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("status")).toContainText("Settings saved");

  await page.goto("/word/scripture");
  await page.getByRole("button", { name: "fear" }).first().click();
  await expect(page.getByText("Why this surfaced", { exact: false })).toBeVisible();

  await page.goto("/word/journal");
  await page.getByLabel("What are you carrying?").fill("A quiet exploratory note");
  await page.getByRole("button", { name: "Clear draft" }).click();
  await expect(page.getByLabel("What are you carrying?")).toHaveValue("");

  expect(runtimeErrors).toEqual([]);
});
