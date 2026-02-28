import { spawn } from "child_process";
import { logError } from "../logger";

export interface ForegroundWindowInfo {
  title: string;
  processName: string;
  pid: number;
}

let cachedInfo: ForegroundWindowInfo | null = null;
let cachedAtMs = 0;
let inFlight: Promise<ForegroundWindowInfo | null> | null = null;

export async function getForegroundWindowInfo(nowMs: number): Promise<ForegroundWindowInfo | null> {
  if (cachedInfo && nowMs - cachedAtMs < 1000) {
    return cachedInfo;
  }
  if (inFlight) {
    return inFlight;
  }

  inFlight = runForegroundWindowQuery()
    .then((info) => {
      cachedInfo = info;
      cachedAtMs = nowMs;
      return info;
    })
    .catch((error) => {
      logError("Foreground window query failed", error);
      return cachedInfo;
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}

function runForegroundWindowQuery(): Promise<ForegroundWindowInfo | null> {
  if (process.platform !== "win32") {
    return Promise.resolve(null);
  }

  const script = [
    "$ErrorActionPreference = 'Stop'",
    "Add-Type @\"",
    "using System;",
    "using System.Runtime.InteropServices;",
    "using System.Text;",
    "public static class TableCatForeground {",
    "  [DllImport(\"user32.dll\")] public static extern IntPtr GetForegroundWindow();",
    "  [DllImport(\"user32.dll\", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);",
    "  [DllImport(\"user32.dll\", SetLastError=true)] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);",
    "}",
    "\"@",
    "$hwnd = [TableCatForeground]::GetForegroundWindow()",
    "if ($hwnd -eq [IntPtr]::Zero) { Write-Output '{}'; exit 0 }",
    "$builder = New-Object System.Text.StringBuilder 1024",
    "[TableCatForeground]::GetWindowText($hwnd, $builder, $builder.Capacity) | Out-Null",
    "$pid = 0",
    "[TableCatForeground]::GetWindowThreadProcessId($hwnd, [ref]$pid) | Out-Null",
    "$proc = Get-Process -Id $pid -ErrorAction SilentlyContinue",
    "[PSCustomObject]@{",
    "  title = $builder.ToString()",
    "  processName = if ($proc) { $proc.ProcessName } else { '' }",
    "  pid = [int]$pid",
    "} | ConvertTo-Json -Compress"
  ].join("\n");

  return new Promise((resolve, reject) => {
    const child = spawn(
      "powershell",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", "-"],
      { stdio: ["pipe", "pipe", "pipe"], windowsHide: true }
    );
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("Foreground window query timeout"));
    }, 1200);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(stderr || stdout || `Foreground window query failed: ${code}`));
        return;
      }
      const text = stdout.trim();
      if (!text || text === "{}") {
        resolve(null);
        return;
      }
      const parsed = JSON.parse(text) as Partial<ForegroundWindowInfo>;
      resolve({
        title: String(parsed.title ?? ""),
        processName: String(parsed.processName ?? ""),
        pid: Number(parsed.pid ?? 0)
      });
    });

    child.stdin.write(script);
    child.stdin.end();
  });
}
