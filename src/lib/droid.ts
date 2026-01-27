import { spawn } from "child_process";
import { readFile } from "fs/promises";
import { join } from "path";
import type { OrcaConfig } from "./types.js";

export interface DroidInvocation {
  droid: string;
  prompt: string;
  autoLevel?: "low" | "medium" | "high";
  model?: string;
  cwd?: string;
  timeout?: number; // in milliseconds
}

export interface DroidResult {
  success: boolean;
  output: string;
  exitCode: number;
  timedOut?: boolean;
}

const DROIDS_DIR = join(process.env.HOME || "~", ".factory", "droids");

export async function getDroidPrompt(droidName: string): Promise<string | null> {
  const droidPath = join(DROIDS_DIR, `${droidName}.md`);
  try {
    const content = await readFile(droidPath, "utf-8");
    // Extract content after frontmatter
    const parts = content.split("---");
    if (parts.length >= 3) {
      return parts.slice(2).join("---").trim();
    }
    return content;
  } catch {
    return null;
  }
}

export async function listAvailableDroids(): Promise<string[]> {
  const { readdir } = await import("fs/promises");
  try {
    const files = await readdir(DROIDS_DIR);
    return files
      .filter((f) => f.endsWith(".md"))
      .map((f) => f.replace(".md", ""));
  } catch {
    return [];
  }
}

export function invokeDroid(
  invocation: DroidInvocation,
  config: OrcaConfig,
  onOutput?: (chunk: string) => void
): Promise<DroidResult> {
  return new Promise(async (resolve) => {
    const droidPrompt = await getDroidPrompt(invocation.droid);
    
    const fullPrompt = droidPrompt
      ? `You are acting as the ${invocation.droid} droid. Follow these instructions:\n\n${droidPrompt}\n\n---\n\nTask:\n${invocation.prompt}`
      : invocation.prompt;

    const args = [
      "exec",
      "--auto",
      invocation.autoLevel || config.droids.auto_level,
      "--model",
      invocation.model || config.droids.model,
      "--output-format",
      "text",
    ];

    // Use --cwd flag to set working directory instead of spawn cwd
    // This way droid runs in the right directory but spawn can find the binary
    if (invocation.cwd) {
      args.push("--cwd", invocation.cwd);
    }

    // Log the full command being executed
    const cmdStr = `droid ${args.join(" ")}`;
    onOutput?.(`[droid] $ ${cmdStr}\n`);
    onOutput?.(`[droid] droid: ${invocation.droid}\n`);
    onOutput?.(`[droid] model: ${invocation.model || config.droids.model}\n`);
    onOutput?.(`[droid] auto: ${invocation.autoLevel || config.droids.auto_level}\n`);
    onOutput?.(`[droid] cwd: ${invocation.cwd || process.cwd()}\n`);
    onOutput?.(`[droid] prompt length: ${fullPrompt.length} chars\n\n`);

    // Use full path to droid binary - shell: true causes stdin buffering issues with large prompts
    const droidBin = join(process.env.HOME || "~", ".local", "bin", "droid");
    const proc = spawn(droidBin, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });
    
    onOutput?.(`[droid] spawned pid: ${proc.pid}\n`);

    let output = "";
    let timedOut = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    // Set timeout (default 10 minutes)
    const timeoutMs = invocation.timeout || 10 * 60 * 1000;
    timeoutId = setTimeout(() => {
      timedOut = true;
      onOutput?.(`\n[TIMEOUT after ${timeoutMs / 1000}s - killing process]\n`);
      proc.kill("SIGTERM");
      setTimeout(() => {
        if (!proc.killed) {
          proc.kill("SIGKILL");
        }
      }, 5000);
    }, timeoutMs);

    proc.stdout.on("data", (data) => {
      const chunk = data.toString();
      output += chunk;
      onOutput?.(chunk);
    });

    proc.stderr.on("data", (data) => {
      const chunk = data.toString();
      output += chunk;
      onOutput?.(chunk);
    });

    // Send the prompt via stdin
    proc.stdin.write(fullPrompt);
    proc.stdin.end();

    proc.on("close", (code) => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      onOutput?.(`\n[droid] exit code: ${code}${timedOut ? " (timed out)" : ""}\n`);
      onOutput?.(`[droid] output length: ${output.length} chars\n`);
      resolve({
        success: code === 0 && !timedOut,
        output,
        exitCode: code || 0,
        timedOut,
      });
    });

    proc.on("error", (err) => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      onOutput?.(`\n[droid] ERROR: ${err.message}\n`);
      resolve({
        success: false,
        output: output + "\n" + err.message,
        exitCode: 1,
      });
    });
  });
}

export function assignDroidByShardType(
  type: "backend" | "frontend" | "fullstack" | "docs"
): string {
  switch (type) {
    case "backend":
      return "senior-backend-engineer";
    case "frontend":
      return "frontend-developer";
    case "fullstack":
      return "fullstack-developer";
    case "docs":
      return "documentation-specialist";
    default:
      return "fullstack-developer";
  }
}
