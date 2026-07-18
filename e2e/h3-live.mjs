import { createHash, X509Certificate } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { chromium } from "@playwright/test";

const windows = process.platform === "win32";
const pythonCandidates = [
  process.env.CENACLE_PYTHON,
  windows ? ".venv/Scripts/python.exe" : ".venv/bin/python",
  "python",
].filter(Boolean);
const python = pythonCandidates.find(
  (candidate) => candidate === "python" || existsSync(candidate),
);
if (!python)
  throw new Error(
    "Create .venv or set CENACLE_PYTHON to a Python with room_origin requirements installed.",
  );

const npm = windows ? "npm.cmd" : "npm";
run(python, ["room_origin/scripts/generate_dev_cert.py"]);
run(npm, ["run", "build"], {
  ...process.env,
  VITE_ROOM_ORIGIN: "https://127.0.0.1:4433",
});

const certificate = new X509Certificate(
  readFileSync("room_origin/data/certificate.pem"),
);
const publicKey = certificate.publicKey.export({ type: "spki", format: "der" });
const spki = createHash("sha256").update(publicKey).digest("base64");
const origin = spawn(
  python,
  [
    "-m",
    "room_origin.cenacle_origin.server",
    "--host",
    "127.0.0.1",
    "--port",
    "4433",
  ],
  {
    env: {
      ...process.env,
      CENACLE_ALLOWED_ORIGINS: "https://127.0.0.1:4433",
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  },
);
let originErrors = "";
origin.stderr.on("data", (data) => {
  originErrors += data.toString();
});

let browser;
try {
  await new Promise((resolve) => setTimeout(resolve, 1_500));
  if (origin.exitCode !== null) {
    throw new Error(`Room origin exited before acceptance:\n${originErrors}`);
  }
  browser = await chromium.launch({
    channel: process.env.CENACLE_BROWSER_CHANNEL || "msedge",
    headless: true,
    args: [
      "--origin-to-force-quic-on=127.0.0.1:4433",
      `--ignore-certificate-errors-spki-list=${spki}`,
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      "--enable-features=WebTransportDeveloperMode",
    ],
  });
  const permissions = ["camera", "microphone"];
  const hostContext = await browser.newContext({ permissions });
  const guestContext = await browser.newContext({ permissions });
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();

  await host.goto("https://127.0.0.1:4433/", {
    waitUntil: "domcontentloaded",
    timeout: 15_000,
  });
  await host.getByRole("link", { name: "Host a room" }).first().click();
  await host.getByRole("button", { name: "Go live" }).waitFor();
  await host.getByRole("button", { name: "Go live" }).click();
  await host.waitForURL("**/room/*", { timeout: 20_000 });
  const code = await host
    .locator("[data-room-code]")
    .getAttribute("data-room-code");
  if (!code) throw new Error("The host did not receive a room code.");

  await guest.goto(`https://127.0.0.1:4433/r/${code}`, {
    waitUntil: "domcontentloaded",
    timeout: 15_000,
  });
  await guest
    .getByRole("dialog", { name: "Camera and microphone permission" })
    .waitFor();
  await guest.getByRole("button", { name: "Allow camera & mic" }).click();
  await guest.getByRole("button", { name: "Enter live room" }).click();
  await guest.waitForURL("**/room/*", { timeout: 20_000 });

  await host.getByText("2 present").waitFor({ timeout: 15_000 });
  await guest.getByText("2 present").waitFor({ timeout: 15_000 });
  const latency = guest.getByText(/^\d+ ms glass-to-glass$/).first();
  await latency.waitFor({ timeout: 20_000 });
  const samples = [];
  for (let index = 0; index < 20; index += 1) {
    samples.push(
      Number.parseInt(
        (await latency.textContent())?.split(" ")[0] ?? "9999",
        10,
      ),
    );
    await guest.waitForTimeout(100);
  }
  samples.sort((first, second) => first - second);
  const median = samples[Math.floor(samples.length / 2)];
  if (!Number.isFinite(median) || median >= 400)
    throw new Error(
      `Median glass-to-glass latency ${median} ms exceeds the 400 ms budget.`,
    );
  console.log(
    `HTTP/3 + native WebTransport: 2 participants, median ${median} ms, max ${Math.max(...samples)} ms`,
  );
} finally {
  await browser?.close();
  if (origin.exitCode === null) origin.kill();
}

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env,
    stdio: "inherit",
    windowsHide: true,
    shell: windows && command.endsWith(".cmd"),
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} exited with ${result.status}`,
    );
  }
}
