import { readFile, readdir } from "fs/promises";
import { join } from "path";
import { DroidAdapter, type AutoLevel } from "./droid-adapter.js";

export interface DroidInvocation {
  droid: string;
  prompt: string;
  model: string; // Required - must be provided
  autoLevel?: AutoLevel;
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
  onOutput?: (chunk: string) => void
): Promise<DroidResult> {
  return new Promise(async (resolve) => {
    const droidPrompt = await getDroidPrompt(invocation.droid);

    const fullPrompt = droidPrompt
      ? `You are acting as the ${invocation.droid} droid. Follow these instructions:\n\n${droidPrompt}\n\n---\n\nTask:\n${invocation.prompt}`
      : invocation.prompt;

    const cwd = invocation.cwd || process.cwd();
    const autoLevel = invocation.autoLevel || "medium";

    // Log session info
    onOutput?.(`[droid] Starting session...\n`);
    onOutput?.(`[droid] droid: ${invocation.droid}\n`);
    onOutput?.(`[droid] model: ${invocation.model}\n`);
    onOutput?.(`[droid] auto: ${autoLevel}\n`);
    onOutput?.(`[droid] cwd: ${cwd}\n`);
    onOutput?.(`[droid] prompt length: ${fullPrompt.length} chars\n\n`);

    let output = "";
    let timedOut = false;
    let exitCode = 0;

    try {
      const adapter = new DroidAdapter({
        cwd,
        model: invocation.model,
        autoLevel,
        timeout: invocation.timeout || 10 * 60 * 1000,
      });

      // Stream messages to output
      adapter.on("message", (msg) => {
        if (msg.role === "assistant" && msg.text) {
          output += msg.text;
          onOutput?.(msg.text);
        }
        if (msg.toolUse) {
          const toolInfo = `\n[Tool: ${msg.toolUse.name}]\n`;
          output += toolInfo;
          onOutput?.(toolInfo);
        }
      });

      // Stream tool results
      adapter.on("tool_result", (result) => {
        const resultInfo = `\n[Tool Result: ${result.toolUseId}]\n${result.content}\n`;
        output += resultInfo;
        onOutput?.(resultInfo);
      });

      // Handle errors
      adapter.on("error", (err) => {
        const errInfo = `\n[Error: ${err.message}]\n`;
        output += errInfo;
        onOutput?.(errInfo);
      });

      // Handle stderr (debug info)
      adapter.on("stderr", (line) => {
        // Optionally log stderr: onOutput?.(`[stderr] ${line}\n`);
      });

      // Start session
      const session = await adapter.start();
      onOutput?.(`[droid] session: ${session.sessionId}\n`);
      onOutput?.(`[droid] using model: ${session.modelId}\n\n`);

      // Send prompt and wait for completion
      await adapter.sendPrompt(fullPrompt);

      // Clean up
      await adapter.stop();

      onOutput?.(`\n[droid] completed successfully\n`);
    } catch (error) {
      const err = error as Error;
      if (err.message === "Prompt timeout") {
        timedOut = true;
        onOutput?.(`\n[droid] TIMEOUT\n`);
      } else {
        output += `\nError: ${err.message}\n`;
        onOutput?.(`\n[droid] ERROR: ${err.message}\n`);
        exitCode = 1;
      }
    }

    resolve({
      success: exitCode === 0 && !timedOut,
      output,
      exitCode,
      timedOut,
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
