import { existsSync, mkdirSync, writeFileSync } from "fs";
import path from "path";
import { desktopCapturer, screen, shell, nativeImage } from "electron";
import { PerceptionInput } from "../../shared/types";
import { logInfo } from "../logger";

type ScreenSource = Awaited<ReturnType<typeof desktopCapturer.getSources>>[number];

export interface CapturedScreenImage {
  capturedAt: Date;
  width: number;
  height: number;
  pngBuffer: Buffer;
  bitmapBuffer: Buffer;
  image: Electron.NativeImage;
}

const SCREENSHOT_ROOT_DIR = path.join(process.cwd(), "LOG", "screenshots");
const SESSION_ID = buildSessionId(new Date());
const SESSION_DIR = path.join(SCREENSHOT_ROOT_DIR, SESSION_ID);
let captureIndex = 0;

export async function captureScreenPerceptionInput(): Promise<PerceptionInput> {
  ensureSessionDir();
  const capture = await capturePrimaryDisplayImage();

  captureIndex += 1;
  const fileName = `${String(captureIndex).padStart(4, "0")}_${buildFileStamp(capture.capturedAt)}.png`;
  const filePath = path.join(SESSION_DIR, fileName);
  savePngBuffer(filePath, capture.pngBuffer);
  logInfo(`Screen capture saved: ${filePath}`);

  return {
    source: "screen",
    content: `Attached desktop screenshot captured at ${capture.capturedAt.toISOString()}.`,
    image_path: filePath,
    image_mime_type: "image/png"
  };
}

export async function captureScreenImage(
  size: { width: number; height: number }
): Promise<CapturedScreenImage> {
  const primaryDisplay = screen.getPrimaryDisplay();
  const captureSize = {
    width: Math.max(1, Math.floor(size.width)),
    height: Math.max(1, Math.floor(size.height))
  };
  const sources = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: captureSize,
    fetchWindowIcons: false
  });
  const source = selectScreenSource(sources, String(primaryDisplay.id));
  if (!source) {
    throw new Error("No desktop capture source available");
  }
  if (source.thumbnail.isEmpty()) {
    throw new Error("Desktop capture thumbnail is empty");
  }

  const image = source.thumbnail;
  return {
    capturedAt: new Date(),
    width: image.getSize().width,
    height: image.getSize().height,
    pngBuffer: image.toPNG(),
    bitmapBuffer: image.toBitmap(),
    image
  };
}

export async function capturePrimaryDisplayImage(): Promise<CapturedScreenImage> {
  const primaryDisplay = screen.getPrimaryDisplay();
  const captureWidth = Math.max(
    1,
    Math.floor(primaryDisplay.size.width * Math.max(1, primaryDisplay.scaleFactor || 1))
  );
  const captureHeight = Math.max(
    1,
    Math.floor(primaryDisplay.size.height * Math.max(1, primaryDisplay.scaleFactor || 1))
  );
  return captureScreenImage({
    width: captureWidth,
    height: captureHeight
  });
}

export function cropImageToPngBuffer(
  capture: CapturedScreenImage,
  box: { x: number; y: number; width: number; height: number }
): Buffer {
  const cropped = capture.image.crop({
    x: Math.max(0, box.x),
    y: Math.max(0, box.y),
    width: Math.max(1, box.width),
    height: Math.max(1, box.height)
  });
  const normalized = cropped.isEmpty() ? nativeImage.createFromBuffer(capture.pngBuffer) : cropped;
  return normalized.toPNG();
}

export function savePngBuffer(filePath: string, pngBuffer: Buffer): void {
  ensureDir(path.dirname(filePath));
  writeFileSync(filePath, pngBuffer);
}

export async function openScreenshotSessionFolder(): Promise<string> {
  ensureSessionDir();
  const errorMessage = await shell.openPath(SESSION_DIR);
  if (errorMessage) {
    throw new Error(errorMessage);
  }
  return SESSION_DIR;
}

function ensureSessionDir(): void {
  ensureDir(SESSION_DIR);
}

function ensureDir(targetDir: string): void {
  if (!existsSync(targetDir)) {
    mkdirSync(targetDir, { recursive: true });
  }
}

function selectScreenSource(
  sources: ScreenSource[],
  primaryDisplayId: string
): ScreenSource | undefined {
  return sources.find((item) => item.display_id === primaryDisplayId) ?? sources[0];
}

function buildSessionId(date: Date): string {
  return [
    date.getFullYear(),
    pad2(date.getMonth() + 1),
    pad2(date.getDate())
  ].join("-") +
    "_" +
    [
      pad2(date.getHours()),
      pad2(date.getMinutes()),
      pad2(date.getSeconds())
    ].join("-");
}

function buildFileStamp(date: Date): string {
  return [
    date.getFullYear(),
    pad2(date.getMonth() + 1),
    pad2(date.getDate())
  ].join("") +
    "-" +
    [
      pad2(date.getHours()),
      pad2(date.getMinutes()),
      pad2(date.getSeconds())
    ].join("") +
    `-${String(date.getMilliseconds()).padStart(3, "0")}`;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}
