import { spawn, type ChildProcess } from "child_process";
import { EventEmitter } from "events";
import type { OrcaConfig } from "./types.js";

export interface DroidSessionOptions {
  model: string;
  autoLevel: "low" | "medium" | "high";
  cwd: string;
  sessionId?: string;
}

export interface StreamMessage {
  type: "text" | "tool_use" | "tool_result" | "thinking" | "error" | "done";
  content: string;
  toolName?: string;
  toolId?: string;
}

/**
 * Interactive droid session using stream-json format
 * Allows multi-turn conversations within the TUI
 */
export class DroidSession extends EventEmitter {
  private proc: ChildProcess | null = null;
  private options: DroidSessionOptions;
  private buffer: string = "";
  private isRunning: boolean = false;
  private sessionId: string | null = null;

  constructor(options: DroidSessionOptions) {
    super();
    this.options = options;
  }

  /**
   * Start the droid session
   */
  start(): void {
    if (this.isRunning) {
      this.emit("error", new Error("Session already running"));
      return;
    }

    const args = [
      "exec",
      "--auto", this.options.autoLevel,
      "--model", this.options.model,
      "--input-format", "stream-json",
      "--output-format", "stream-json",
      "--cwd", this.options.cwd,
    ];

    if (this.options.sessionId) {
      args.push("--session-id", this.options.sessionId);
    }

    this.proc = spawn("droid", args, {
      cwd: this.options.cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.isRunning = true;

    this.proc.stdout?.on("data", (data) => {
      this.handleOutput(data.toString());
    });

    this.proc.stderr?.on("data", (data) => {
      this.emit("stderr", data.toString());
    });

    this.proc.on("close", (code) => {
      this.isRunning = false;
      this.emit("close", code);
    });

    this.proc.on("error", (err) => {
      this.isRunning = false;
      this.emit("error", err);
    });

    this.emit("started");
  }

  /**
   * Send a message to the droid
   */
  sendMessage(content: string): void {
    if (!this.proc || !this.isRunning) {
      this.emit("error", new Error("Session not running"));
      return;
    }

    const message = JSON.stringify({ role: "user", content }) + "\n";
    this.proc.stdin?.write(message);
    this.emit("sent", content);
  }

  /**
   * Handle output from the droid process
   */
  private handleOutput(data: string): void {
    this.buffer += data;

    // Process complete JSON lines
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() || ""; // Keep incomplete line in buffer

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const parsed = JSON.parse(line);
        this.processMessage(parsed);
      } catch {
        // Not JSON, emit as raw text
        this.emit("text", line);
      }
    }
  }

  /**
   * Process a parsed message from the droid
   */
  private processMessage(msg: any): void {
    // Handle different message types from stream-json output
    if (msg.type === "message_start") {
      // New message starting
      this.emit("message_start", msg);
    } else if (msg.type === "content_block_start") {
      if (msg.content_block?.type === "tool_use") {
        this.emit("tool_start", {
          toolName: msg.content_block.name,
          toolId: msg.content_block.id,
        });
      } else if (msg.content_block?.type === "thinking") {
        this.emit("thinking_start");
      }
    } else if (msg.type === "content_block_delta") {
      if (msg.delta?.type === "text_delta") {
        this.emit("text", msg.delta.text);
      } else if (msg.delta?.type === "input_json_delta") {
        this.emit("tool_input", msg.delta.partial_json);
      } else if (msg.delta?.type === "thinking_delta") {
        this.emit("thinking", msg.delta.thinking);
      }
    } else if (msg.type === "content_block_stop") {
      this.emit("block_stop");
    } else if (msg.type === "message_stop") {
      this.emit("message_stop");
    } else if (msg.type === "message_delta") {
      if (msg.usage) {
        this.emit("usage", msg.usage);
      }
    } else if (msg.type === "error") {
      this.emit("error", new Error(msg.error?.message || "Unknown error"));
    } else if (msg.session_id) {
      this.sessionId = msg.session_id;
      this.emit("session_id", msg.session_id);
    } else if (msg.content) {
      // Simple text response
      this.emit("text", msg.content);
    } else if (msg.tool_calls || msg.tool_use) {
      // Tool use
      const tools = msg.tool_calls || [msg.tool_use];
      for (const tool of tools) {
        this.emit("tool_use", {
          toolName: tool.name,
          toolId: tool.id,
          input: tool.input,
        });
      }
    } else if (msg.result !== undefined) {
      // Tool result
      this.emit("tool_result", msg.result);
    } else {
      // Unknown message, emit raw
      this.emit("raw", msg);
    }
  }

  /**
   * Stop the session gracefully
   */
  stop(): void {
    if (this.proc && this.isRunning) {
      this.proc.stdin?.end();
      // Give it a moment to close gracefully
      setTimeout(() => {
        if (this.isRunning && this.proc) {
          this.proc.kill("SIGTERM");
        }
      }, 1000);
    }
  }

  /**
   * Force kill the session
   */
  kill(): void {
    if (this.proc) {
      this.proc.kill("SIGKILL");
      this.isRunning = false;
    }
  }

  /**
   * Get the session ID (if assigned)
   */
  getSessionId(): string | null {
    return this.sessionId;
  }

  /**
   * Check if session is running
   */
  isActive(): boolean {
    return this.isRunning;
  }
}

/**
 * Create a new interactive droid session
 */
export function createDroidSession(
  config: OrcaConfig,
  options?: Partial<DroidSessionOptions>
): DroidSession {
  return new DroidSession({
    model: options?.model || config.droids.model,
    autoLevel: options?.autoLevel || config.droids.auto_level,
    cwd: options?.cwd || process.cwd(),
    sessionId: options?.sessionId,
  });
}
