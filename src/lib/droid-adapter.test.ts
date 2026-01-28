/**
 * Test script for DroidAdapter
 *
 * Run with: bun run src/lib/droid-adapter.test.ts
 */

import { DroidAdapter } from "./droid-adapter";

async function main() {
  const model = process.argv[2];
  if (!model) {
    console.error("Usage: bun run src/lib/droid-adapter.test.ts <model>");
    console.error("Example: bun run src/lib/droid-adapter.test.ts claude-sonnet-4-5-20250929");
    process.exit(1);
  }
  console.log("=== DroidAdapter Test ===\n");
  console.log("Model:", model);

  const adapter = new DroidAdapter({
    cwd: process.cwd(),
    autoLevel: "low",
    model,
  });

  // Set up event handlers
  adapter.on("message", (msg) => {
    if (msg.role === "assistant" && msg.text) {
      console.log("\nAssistant:", msg.text);
    }
  });

  adapter.on("stderr", (line) => {
    // Uncomment to see stderr: console.log('[stderr]', line);
  });

  adapter.on("error", (err) => {
    console.error("Error:", err.message);
  });

  try {
    // Start session
    console.log("Starting session...");
    const session = await adapter.start();
    console.log("Session ID:", session.sessionId);
    console.log("Model:", session.modelId);
    console.log("");

    // Send a simple prompt
    console.log("Sending prompt...");
    await adapter.sendPrompt(
      "What is the capital of France? Answer in one word."
    );

    console.log("\n--- Complete ---");
  } catch (error) {
    console.error("Test failed:", error);
  } finally {
    await adapter.stop();
  }
}

main();
