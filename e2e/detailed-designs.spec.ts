import { expect, test, type Page } from "@playwright/test";

async function installCapableBrowserStubs(page: Page): Promise<void> {
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
}

async function installRoomTransportStub(page: Page): Promise<void> {
  await page.addInitScript(() => {
    class LocalWebTransport {
      ready = Promise.resolve();
      closed: Promise<void>;
      datagrams: {
        readable: ReadableStream<Uint8Array>;
        writable: WritableStream<Uint8Array>;
      };
      incomingUnidirectionalStreams: ReadableStream<ReadableStream<Uint8Array>>;
      private closeTransport!: () => void;
      private datagramController!: ReadableStreamDefaultController<Uint8Array>;
      private incomingController!: ReadableStreamDefaultController<
        ReadableStream<Uint8Array>
      >;
      private rosterEmitted = false;

      constructor() {
        this.closed = new Promise<void>((resolve) => {
          this.closeTransport = resolve;
        });
        this.datagrams = {
          readable: new ReadableStream<Uint8Array>({
            start: (controller) => {
              this.datagramController = controller;
            },
          }),
          writable: new WritableStream<Uint8Array>({
            write: (data) => {
              const message = JSON.parse(new TextDecoder().decode(data)) as {
                type: string;
                clientTime?: number;
              };
              if (message.type === "ping") {
                this.emit({
                  type: "pong",
                  clientTime: message.clientTime,
                  serverTime: Date.now(),
                });
              } else if (message.type === "reaction") {
                this.emit(message);
              } else if (message.type === "presence") {
                this.emitRoster();
              }
            },
          }),
        };
        this.incomingUnidirectionalStreams = new ReadableStream({
          start: (controller) => {
            this.incomingController = controller;
          },
        });
        window.setTimeout(() => this.emitRoster(), 750);
      }

      async createUnidirectionalStream(): Promise<WritableStream<Uint8Array>> {
        const chunks: Uint8Array[] = [];
        return new WritableStream<Uint8Array>({
          write: (chunk) => {
            chunks.push(chunk.slice());
          },
          close: () => {
            const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
            const bytes = new Uint8Array(length);
            let offset = 0;
            for (const chunk of chunks) {
              bytes.set(chunk, offset);
              offset += chunk.length;
            }
            if (bytes.length < 4) return;
            const headerLength = new DataView(bytes.buffer).getUint32(0);
            const header = JSON.parse(
              new TextDecoder().decode(bytes.slice(4, 4 + headerLength)),
            ) as Record<string, unknown>;
            header.participantId = "guest-1";
            const encodedHeader = new TextEncoder().encode(
              JSON.stringify(header),
            );
            const relayed = new Uint8Array(
              4 + encodedHeader.length + bytes.length - 4 - headerLength,
            );
            new DataView(relayed.buffer).setUint32(0, encodedHeader.length);
            relayed.set(encodedHeader, 4);
            relayed.set(
              bytes.slice(4 + headerLength),
              4 + encodedHeader.length,
            );
            this.incomingController.enqueue(
              new ReadableStream<Uint8Array>({
                start: (controller) => {
                  controller.enqueue(relayed);
                  controller.close();
                },
              }),
            );
          },
        });
      }

      close(): void {
        this.closeTransport();
        try {
          this.datagramController.close();
          this.incomingController.close();
        } catch {
          // The test transport may already have been closed by room teardown.
        }
      }

      private emit(message: unknown): void {
        this.datagramController.enqueue(
          new TextEncoder().encode(JSON.stringify(message)),
        );
      }

      private emitRoster(): void {
        if (this.rosterEmitted) return;
        this.rosterEmitted = true;
        this.emit({
          type: "roster",
          participants: [
            {
              id: "host-1",
              displayName: "Host",
              role: "host",
              isMuted: false,
              isCameraOff: false,
              isSpeaking: false,
            },
            {
              id: "guest-1",
              displayName: "Guest",
              role: "participant",
              isMuted: false,
              isCameraOff: false,
              isSpeaking: false,
            },
          ],
        });
      }
    }

    Object.defineProperty(window, "WebTransport", {
      configurable: true,
      value: LocalWebTransport,
    });
  });
}

async function settle(page: Page): Promise<void> {
  await page.waitForLoadState("domcontentloaded");
  await page.waitForFunction(() =>
    Boolean(document.querySelector("#root")?.firstElementChild),
  );
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(100);
}

test.describe("detailed-design browser acceptance", () => {
  test("every public screen reflows without page-level overflow from XS through XL", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await installCapableBrowserStubs(page);
    const paths = [
      "/",
      "/host",
      "/join",
      "/word/scripture",
      "/word/journal",
      "/settings",
      "/support",
      "/not-a-page",
    ];
    const widths = [375, 600, 800, 1024, 1280];

    for (const width of widths) {
      await page.setViewportSize({ width, height: 900 });
      for (const path of paths) {
        await page.goto(path);
        await settle(page);
        const dimensions = await page.evaluate(() => ({
          body: document.body.scrollWidth,
          root: document.documentElement.scrollWidth,
          viewport: document.documentElement.clientWidth,
        }));
        expect(
          dimensions.body,
          `${path} body at ${width}px`,
        ).toBeLessThanOrEqual(dimensions.viewport);
        expect(
          dimensions.root,
          `${path} root at ${width}px`,
        ).toBeLessThanOrEqual(dimensions.viewport);
      }
    }
  });

  test("private Word actions are inert and make zero requests", async ({
    page,
  }) => {
    await installCapableBrowserStubs(page);
    await page.goto("/word/scripture");
    await settle(page);
    await page.waitForTimeout(500);
    const outbound: string[] = [];
    page.on("request", (request) => outbound.push(request.url()));

    await page
      .getByLabel("Name a theme")
      .fill('fear <img src=x onerror="window.__cenacleXss=true">');
    await page.getByRole("button", { name: "Surface a passage" }).click();
    await expect(page.getByText("Why this surfaced")).toBeVisible();
    expect(await page.locator('img[src="x"]').count()).toBe(0);
    expect(
      await page.evaluate(
        () => (window as Window & { __cenacleXss?: boolean }).__cenacleXss,
      ),
    ).toBeUndefined();
    expect(outbound).toEqual([]);

    await page.goto("/word/journal");
    await settle(page);
    outbound.length = 0;
    await page
      .getByLabel("What are you carrying?")
      .fill("<script>window.__cenacleXss=true</script> grief");
    await page.getByRole("button", { name: "Save entry" }).click();
    await expect(page.getByText("Saved on this device.")).toBeVisible();
    expect(
      await page.locator("script").filter({ hasText: "__cenacleXss" }).count(),
    ).toBe(0);
    expect(
      await page.evaluate(
        () => (window as Window & { __cenacleXss?: boolean }).__cenacleXss,
      ),
    ).toBeUndefined();
    expect(outbound).toEqual([]);

    await page.getByRole("button", { name: "Ask for a reflection" }).click();
    await expect(
      page.getByText("The last word remains yours.", { exact: false }),
    ).toBeVisible();
    expect(outbound).toEqual([]);
  });

  test("the shell is interactive inside budget and reduced motion reaches the night register", async ({
    page,
    context,
  }) => {
    await installCapableBrowserStubs(page);
    const session = await context.newCDPSession(page);
    await session.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    const started = Date.now();
    await page.goto("/");
    await page.getByRole("link", { name: "Host a room" }).first().waitFor();
    expect(Date.now() - started).toBeLessThanOrEqual(3_000);

    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/word/journal");
    await settle(page);
    const animationDuration = await page.evaluate(
      () => getComputedStyle(document.body, "::before").animationDuration,
    );
    expect(Number.parseFloat(animationDuration)).toBeLessThanOrEqual(0.01);
  });

  test("missing local capabilities explain degradation without offering live entry", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, "WebTransport", {
        configurable: true,
        value: undefined,
      });
      Object.defineProperty(window, "VideoEncoder", {
        configurable: true,
        value: undefined,
      });
      Object.defineProperty(window, "VideoDecoder", {
        configurable: true,
        value: undefined,
      });
      Object.defineProperty(navigator, "gpu", {
        configurable: true,
        value: undefined,
      });
      Object.defineProperty(window, "LanguageModel", {
        configurable: true,
        value: undefined,
      });
    });

    await page.goto("/support");
    await settle(page);
    await expect(page.getByText("0 of 4 capabilities ready")).toBeVisible();
    await expect(
      page.getByText("Google Chrome or Microsoft Edge", { exact: false }),
    ).toBeVisible();
    await expect(
      page.getByText("cloud fallback", { exact: false }),
    ).toBeVisible();
    await expect(
      page.getByText("still backdrop with zero requests", { exact: false }),
    ).toBeVisible();

    await page.goto("/host");
    await settle(page);
    await expect(
      page.getByText("Live gathering unavailable here"),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: /go live/i })).toHaveCount(0);
  });

  test("a host can enter the room and operate accessible live controls", async ({
    page,
  }) => {
    test.setTimeout(30_000);
    await installCapableBrowserStubs(page);
    await installRoomTransportStub(page);
    await page.route("https://localhost:4433/**", async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (path === "/api/rooms" && request.method() === "POST") {
        await route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify({
            code: "ABC234",
            participantId: "host-1",
            token: "test-token",
            expiresAt: Date.now() + 60_000,
          }),
        });
      } else {
        await route.fulfill({ status: 204, body: "" });
      }
    });

    await page.goto("/host");
    await settle(page);
    await expect(page.getByText("Nothing is recorded.")).toBeVisible();
    await page.getByRole("button", { name: "Go live" }).click();
    await expect(page).toHaveURL(/\/room\/ABC234$/);
    await expect(page.locator('[data-room-code="ABC234"]')).toBeVisible();
    await expect(page.getByText("Live · ABC234")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Mute" }).last(),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Camera off" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Surface a passage" }),
    ).toBeVisible();
    await expect(page.getByText("2 present")).toBeVisible();
    const latency = page.getByText(/^\d+ ms glass-to-glass$/).first();
    await expect(latency).toBeVisible();
    const latencySamples: number[] = [];
    for (let sample = 0; sample < 12; sample += 1) {
      latencySamples.push(
        Number.parseInt((await latency.textContent()) ?? "9999", 10),
      );
      await page.waitForTimeout(100);
    }
    latencySamples.sort((first, second) => first - second);
    expect(latencySamples[Math.floor(latencySamples.length / 2)]).toBeLessThan(
      400,
    );

    const inviteButton = page.getByRole("button", { name: "Invite" });
    await inviteButton.click();
    const inviteDialog = page.getByRole("dialog", { name: "Invite someone" });
    await expect(inviteDialog).toBeVisible();
    await expect(inviteDialog.getByLabel("Invite link")).toHaveValue(
      "http://127.0.0.1:4178/r/ABC234",
    );
    await page.keyboard.press("Escape");
    await expect(inviteDialog).toBeHidden();
    await expect(inviteButton).toBeFocused();

    await page.getByRole("button", { name: "Amen · 0" }).click();
    await expect(page.getByRole("button", { name: "Amen · 1" })).toBeVisible();
    await expect(page.locator('[data-live-region="polite"]')).toContainText(
      "1 reactions in the last minute",
    );

    await page.setViewportSize({ width: 375, height: 800 });
    const noOverflow = await page.evaluate(
      () => document.body.scrollWidth <= document.documentElement.clientWidth,
    );
    expect(noOverflow).toBe(true);

    const endButton = page.getByRole("button", { name: "End" });
    await endButton.click();
    const endDialog = page.getByRole("alertdialog", {
      name: "End the gathering for everyone?",
    });
    await expect(endDialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(endDialog).toBeHidden();
    await expect(endButton).toBeFocused();
  });
});
