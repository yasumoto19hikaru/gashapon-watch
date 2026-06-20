import { chromium } from "playwright";
import { createHash } from "crypto";
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import "dotenv/config";

const TARGET_URL =
  process.env.TARGET_URL ??
  "https://gashapon.jp/shop/gplus_list.php?product_code=4582769911538";

const NTFY_TOPIC = process.env.NTFY_TOPIC;
const NTFY_SERVER = process.env.NTFY_SERVER ?? "https://ntfy.sh";

const STATE_DIR = path.resolve("state");
const STATE_FILE = path.join(STATE_DIR, "snapshot.json");

type Snapshot = {
  url: string;
  hash: string;
  text: string;
  checkedAt: string;
};

function normalizeText(text: string): string {
  return text
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

async function loadPrevious(): Promise<Snapshot | null> {
  try {
    const raw = await readFile(STATE_FILE, "utf-8");
    return JSON.parse(raw) as Snapshot;
  } catch {
    return null;
  }
}

async function saveSnapshot(snapshot: Snapshot): Promise<void> {
  await mkdir(STATE_DIR, { recursive: true });
  await writeFile(STATE_FILE, JSON.stringify(snapshot, null, 2), "utf-8");
}

function buildLineDiff(oldText: string, newText: string): string {
  const oldLines = oldText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const newLines = newText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const oldSet = new Set(oldLines);
  const newSet = new Set(newLines);

  const added = newLines.filter((line) => !oldSet.has(line));
  const removed = oldLines.filter((line) => !newSet.has(line));

  const parts: string[] = [];

  if (added.length > 0) {
    parts.push("【追加された行】");
    parts.push(...added.map((line) => `+ ${line}`));
  }

  if (removed.length > 0) {
    if (parts.length > 0) parts.push("");
    parts.push("【消えた行】");
    parts.push(...removed.map((line) => `- ${line}`));
  }

  if (parts.length === 0) {
    return "本文ハッシュは変化しましたが、行単位の追加・削除は検出できませんでした。表示順、空白、JS描画内容などが変わった可能性があります。";
  }

  return parts.join("\n");
}

function limitMessage(message: string): string {
  const maxLength = 3800;

  if (message.length <= maxLength) {
    return message;
  }

  return (
    message.slice(0, maxLength) +
    "\n\n...差分が長すぎるため途中まで表示しています。詳細はGitHub Actionsログまたはstate/snapshot.jsonを確認してください。"
  );
}

async function notifyNtfy(
  message: string,
  title = "ガシャポン更新検知"
): Promise<void> {
  if (!NTFY_TOPIC) {
    console.log("NTFY_TOPIC is not set. Skip notification.");
    return;
  }

  const server = NTFY_SERVER.replace(/\/$/, "");
  const url = new URL(`${server}/${encodeURIComponent(NTFY_TOPIC)}`);
  url.searchParams.set("title", title);
  url.searchParams.set("priority", "high");
  url.searchParams.set("tags", "bell");

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain; charset=utf-8"
    },
    body: limitMessage(message)
  });

  if (!res.ok) {
    throw new Error(`ntfy failed: ${res.status} ${res.statusText}`);
  }
}

async function fetchPageText(): Promise<string> {
  const browser = await chromium.launch({
    headless: true
  });

  try {
    const page = await browser.newPage({
      userAgent:
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126 Safari/537.36"
    });

    await page.goto(TARGET_URL, {
      waitUntil: "networkidle",
      timeout: 60000
    });

    // ページ側のJavaScript描画待ち
    await page.waitForTimeout(5000);

    const text = await page.locator("body").innerText({
      timeout: 15000
    });

    return normalizeText(text);
  } finally {
    await browser.close();
  }
}

async function main() {
  const previous = await loadPrevious();

  const text = await fetchPageText();
  const hash = hashText(text);

  const current: Snapshot = {
    url: TARGET_URL,
    hash,
    text,
    checkedAt: new Date().toISOString()
  };

  if (!previous) {
    await saveSnapshot(current);
    console.log("Initial snapshot saved. No notification sent.");
    return;
  }

  if (previous.hash === current.hash) {
    console.log(`No change. checkedAt=${current.checkedAt}`);
    return;
  }

  const diff = buildLineDiff(previous.text, current.text);

  const message = [
    "ガシャポンページの更新を検知しました。",
    "",
    diff,
    "",
    `URL: ${TARGET_URL}`,
    `checkedAt: ${current.checkedAt}`,
    "",
    "※掲載内容と実際の店舗在庫は異なる場合があります。"
  ].join("\n");

  console.log(message);

  await notifyNtfy(message);
  await saveSnapshot(current);

  console.log("Change detected. Notification sent and snapshot saved.");
}

main().catch(async (error) => {
  const message = [
    "ガシャポン監視botでエラーが発生しました。",
    "",
    String(error?.stack ?? error),
    "",
    `URL: ${TARGET_URL}`
  ].join("\n");

  console.error(message);

  try {
    await notifyNtfy(message, "ガシャポン監視エラー");
  } catch (notifyError) {
    console.error("Failed to notify error:", notifyError);
  }

  process.exit(1);
});
