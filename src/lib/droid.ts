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
}

export interface DroidResult {
  success: boolean;
  output: string;
  exitCode: number;
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

    if (invocation.cwd) {
      args.push("--cwd", invocation.cwd);
    }

    const proc = spawn("droid", args, {
      cwd: invocation.cwd || process.cwd(),
      stdio: ["pipe", "pipe", "pipe"],
    });

    let output = "";

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
      resolve({
        success: code === 0,
        output,
        exitCode: code || 0,
      });
    });

    proc.on("error", (err) => {
      resolve({
        success: false,
        output: err.message,
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
