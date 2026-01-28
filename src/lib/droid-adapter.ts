/**
 * Droid Adapter - Programmatic interface to Factory Droid CLI
 *
 * Uses the stream-jsonrpc protocol to control droid sessions programmatically.
 * Based on Factory API v1.0.0 format.
 *
 * Usage:
 *   const adapter = new DroidAdapter({ cwd: '/path/to/project', autoLevel: 'medium' });
 *   await adapter.start();
 *   const response = await adapter.sendPrompt('Fix the bug in app.ts');
 *   await adapter.stop();
 */

import { spawn, type ChildProcess } from "node:child_process";
import { createInterface, type Interface } from "node:readline";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";

export type AutoLevel = "low" | "medium" | "high";

export interface DroidAdapterOptions {
  cwd: string;
  model: string; // Required - no default
  autoLevel?: AutoLevel;
  timeout?: number; // Session timeout in ms (default: 5 minutes)
}

export interface DroidSession {
  sessionId: string;
  modelId: string;
  availableModels: Array<{ id: string; displayName: string }>;
}

export interface DroidMessage {
  role: "user" | "assistant" | "system";
  text?: string;
  toolUse?: {
    id: string;
    name: string;
    input: Record<string, unknown>;
  };
}

export interface DroidToolResult {
  toolUseId: string;
  content: string;
}

export type DroidEvent =
  | { type: "state_change"; state: "idle" | "streaming_assistant_message" }
  | { type: "message"; message: DroidMessage }
  | { type: "tool_result"; result: DroidToolResult }
  | { type: "error"; message: string }
  | { type: "complete" }
  | { type: "permission_request"; id: string; toolName: string; command: string };

type PermissionResponse = "proceed_once" | "proceed_always" | "cancel";

export class DroidAdapter extends EventEmitter {
  private process: ChildProcess | null = null;
  private session: DroidSession | null = null;
  private requestId = 0;
  private pendingRequests = new Map<
    string,
    { resolve: (result: unknown) => void; reject: (error: Error) => void }
  >();
  private rlStdout: Interface | null = null;
  private rlStderr: Interface | null = null;
  private options: Required<DroidAdapterOptions>;
  private isStreaming = false;
  private pendingIdle = false;

  constructor(options: DroidAdapterOptions) {
    super();
    if (!options.model) {
      throw new Error("DroidAdapter requires a model to be specified");
    }
    this.options = {
      cwd: options.cwd,
      model: options.model,
      autoLevel: options.autoLevel ?? "medium",
      timeout: options.timeout ?? 5 * 60 * 1000,
    };
  }

  /**
   * Start a droid session
   */
  async start(): Promise<DroidSession> {
    const args = [
      "exec",
      "--input-format",
      "stream-jsonrpc",
      "--output-format",
      "stream-jsonrpc",
      "--cwd",
      this.options.cwd,
      "--auto",
      this.options.autoLevel,
    ];

    if (this.options.model) {
      args.push("--model", this.options.model);
    }

    this.process = spawn("droid", args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });

    // Set up stdout handler
    if (this.process.stdout) {
      this.rlStdout = createInterface({ input: this.process.stdout });
      this.rlStdout.on("line", (line) => this.handleLine(line));
    }

    // Set up stderr handler
    if (this.process.stderr) {
      this.rlStderr = createInterface({ input: this.process.stderr });
      this.rlStderr.on("line", (line) => {
        this.emit("stderr", line);
      });
    }

    this.process.on("error", (err) => {
      this.emit("error", err);
    });

    this.process.on("exit", (code) => {
      this.emit("exit", code);
      this.cleanup();
    });

    // Initialize session
    const result = (await this.send("droid.initialize_session", {
      machineId: randomUUID(),
      cwd: this.options.cwd,
    })) as {
      sessionId: string;
      settings?: { modelId?: string };
      availableModels?: Array<{ id: string; displayName: string }>;
    };

    this.session = {
      sessionId: result.sessionId,
      modelId: result.settings?.modelId ?? "unknown",
      availableModels: result.availableModels ?? [],
    };

    // If a specific model was requested and it differs from what was set,
    // update the session settings to use the requested model
    if (this.options.model && this.session.modelId !== this.options.model) {
      // Find matching model in available models (handle partial matches)
      const requestedModel = this.options.model;
      const matchingModel = this.session.availableModels.find(
        (m) =>
          m.id === requestedModel ||
          m.id.startsWith(requestedModel + "-") ||
          m.id.startsWith(requestedModel + "[")
      );

      if (matchingModel) {
        await this.updateSettings({ modelId: matchingModel.id });
        this.session.modelId = matchingModel.id;
      }
    }

    return this.session;
  }

  /**
   * Send a prompt and wait for completion
   */
  async sendPrompt(text: string): Promise<void> {
    if (!this.session) {
      throw new Error("Session not initialized. Call start() first.");
    }

    await this.send("droid.add_user_message", {
      sessionId: this.session.sessionId,
      text,
    });

    // Wait for completion (idle state after streaming)
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Prompt timeout"));
      }, this.options.timeout);

      const onComplete = () => {
        clearTimeout(timeout);
        this.off("complete", onComplete);
        this.off("error", onError);
        resolve();
      };

      const onError = (err: Error) => {
        clearTimeout(timeout);
        this.off("complete", onComplete);
        this.off("error", onError);
        reject(err);
      };

      this.on("complete", onComplete);
      this.on("error", onError);
    });
  }

  /**
   * Update session settings (model, autonomy level, etc.)
   */
  async updateSettings(settings: {
    modelId?: string;
    autonomyLevel?: AutoLevel;
  }): Promise<void> {
    if (!this.session) {
      throw new Error("Session not initialized");
    }

    await this.send("droid.update_session_settings", {
      sessionId: this.session.sessionId,
      settings,
    });
  }

  /**
   * Stop the droid session
   */
  async stop(): Promise<void> {
    if (this.process) {
      this.process.stdin?.end();
      this.process.kill("SIGTERM");
    }
    this.cleanup();
  }

  /**
   * Check if the session is running
   */
  isRunning(): boolean {
    return this.process !== null && !this.process.killed;
  }

  /**
   * Get the current session
   */
  getSession(): DroidSession | null {
    return this.session;
  }

  /**
   * Set permission handler (for handling tool execution requests)
   */
  setPermissionHandler(
    handler: (
      toolName: string,
      command: string
    ) => Promise<PermissionResponse> | PermissionResponse
  ): void {
    this.permissionHandler = handler;
  }

  private permissionHandler: (
    toolName: string,
    command: string
  ) => Promise<PermissionResponse> | PermissionResponse = () => "proceed_once";

  private send(
    method: string,
    params: Record<string, unknown> = {}
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.process?.stdin?.writable) {
        reject(new Error("Process not writable"));
        return;
      }

      const id = String(++this.requestId);
      const msg = {
        jsonrpc: "2.0",
        factoryApiVersion: "1.0.0",
        type: "request",
        method,
        params,
        id,
      };

      this.pendingRequests.set(id, { resolve, reject });
      this.process.stdin.write(JSON.stringify(msg) + "\n");

      // Request timeout
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`Request timeout: ${method}`));
        }
      }, 30000);
    });
  }

  private sendResponse(id: string, result: unknown): void {
    if (!this.process?.stdin?.writable) return;

    const msg = {
      jsonrpc: "2.0",
      factoryApiVersion: "1.0.0",
      type: "response",
      id,
      result,
    };

    this.process.stdin.write(JSON.stringify(msg) + "\n");
  }

  private handleLine(line: string): void {
    try {
      const msg = JSON.parse(line);
      this.emit("raw", msg);

      if (msg.type === "response") {
        const pending = this.pendingRequests.get(msg.id);
        if (pending) {
          this.pendingRequests.delete(msg.id);
          if (msg.error) {
            pending.reject(new Error(msg.error.message));
          } else {
            pending.resolve(msg.result);
          }
        }
      } else if (msg.type === "notification") {
        this.handleNotification(msg.params?.notification);
      } else if (msg.type === "request") {
        this.handleRequest(msg);
      }
    } catch (e) {
      this.emit("parse_error", e, line);
    }
  }

  private handleNotification(notification: Record<string, unknown>): void {
    if (!notification) return;

    switch (notification.type) {
      case "droid_working_state_changed": {
        const state = notification.newState as string;
        this.emit("event", { type: "state_change", state } as DroidEvent);

        if (state === "streaming_assistant_message") {
          this.isStreaming = true;
          this.pendingIdle = false;
        } else if (state === "idle") {
          if (this.isStreaming) {
            this.pendingIdle = true;
          } else {
            this.emit("event", { type: "complete" } as DroidEvent);
            this.emit("complete");
          }
        }
        break;
      }

      case "create_message": {
        const message = notification.message as Record<string, unknown>;
        if (message) {
          const content = message.content as Array<Record<string, unknown>>;
          const textContent = content?.find((c) => c.type === "text");
          const toolUseContent = content?.find((c) => c.type === "tool_use");

          const droidMessage: DroidMessage = {
            role: message.role as "user" | "assistant" | "system",
            text: textContent?.text as string | undefined,
            toolUse: toolUseContent
              ? {
                  id: toolUseContent.id as string,
                  name: toolUseContent.name as string,
                  input: toolUseContent.input as Record<string, unknown>,
                }
              : undefined,
          };

          this.emit("event", { type: "message", message: droidMessage });
          this.emit("message", droidMessage);

          if (message.role === "assistant") {
            this.isStreaming = false;
            if (this.pendingIdle) {
              this.emit("event", { type: "complete" } as DroidEvent);
              this.emit("complete");
              this.pendingIdle = false;
            }
          }
        }
        break;
      }

      case "tool_result": {
        const result: DroidToolResult = {
          toolUseId: notification.toolUseId as string,
          content: notification.content as string,
        };
        this.emit("event", { type: "tool_result", result });
        this.emit("tool_result", result);
        break;
      }

      case "error": {
        this.emit("event", {
          type: "error",
          message: notification.message as string,
        });
        this.emit("error", new Error(notification.message as string));
        break;
      }
    }
  }

  private async handleRequest(msg: {
    id: string;
    method: string;
    params: Record<string, unknown>;
  }): Promise<void> {
    if (msg.method === "droid.request_permission") {
      const toolUses = msg.params.toolUses as Array<{
        toolUse: { id: string; name: string; input: { command?: string } };
      }>;
      const toolUse = toolUses?.[0]?.toolUse;

      if (toolUse) {
        const toolName = toolUse.name;
        const command =
          toolUse.input?.command ?? JSON.stringify(toolUse.input);

        this.emit("event", {
          type: "permission_request",
          id: toolUse.id,
          toolName,
          command,
        } as DroidEvent);

        try {
          const decision = await this.permissionHandler(toolName, command);
          this.sendResponse(msg.id, { selectedOption: decision });
        } catch {
          this.sendResponse(msg.id, { selectedOption: "cancel" });
        }
      } else {
        this.sendResponse(msg.id, { selectedOption: "proceed_once" });
      }
    }
  }

  private cleanup(): void {
    this.rlStdout?.close();
    this.rlStderr?.close();
    this.process = null;
    this.session = null;
    this.pendingRequests.clear();
  }
}

export default DroidAdapter;
