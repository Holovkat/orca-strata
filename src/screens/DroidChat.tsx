import React, { useState, useEffect, useCallback, useRef } from "react";
import { Box, Text, useInput, useStdout } from "ink";
import TextInput from "ink-text-input";
import { Spinner } from "../components/Spinner.js";
import { StatusMessage } from "../components/StatusMessage.js";
import { DroidSession, createDroidSession } from "../lib/droid-session.js";
import type { OrcaConfig, Shard } from "../lib/types.js";

interface DroidChatProps {
  config: OrcaConfig;
  projectPath: string;
  shard?: Shard;
  initialPrompt?: string;
  onBack: () => void;
  onComplete?: (success: boolean) => void;
}

interface ChatMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  toolName?: string;
  timestamp: Date;
}

export function DroidChat({
  config,
  projectPath,
  shard,
  initialPrompt,
  onBack,
  onComplete,
}: DroidChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isWaiting, setIsWaiting] = useState(false);
  const [currentResponse, setCurrentResponse] = useState("");
  const [currentTool, setCurrentTool] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const sessionRef = useRef<DroidSession | null>(null);
  const { stdout } = useStdout();

  // Calculate visible lines based on terminal height
  const terminalHeight = stdout?.rows || 24;
  const visibleMessages = Math.max(5, terminalHeight - 12);

  // Initialize session
  useEffect(() => {
    const session = createDroidSession(config, {
      cwd: projectPath,
    });
    sessionRef.current = session;

    // Set up event handlers
    session.on("started", () => {
      setMessages((prev) => [
        ...prev,
        {
          role: "system",
          content: `Session started with model: ${config.droids.model}`,
          timestamp: new Date(),
        },
      ]);

      // Send initial prompt if provided
      if (initialPrompt) {
        sendMessage(initialPrompt);
      }
    });

    session.on("text", (text: string) => {
      setCurrentResponse((prev) => prev + text);
    });

    session.on("tool_start", ({ toolName }: { toolName: string }) => {
      setCurrentTool(toolName);
    });

    session.on("tool_use", ({ toolName, input }: { toolName: string; input: any }) => {
      setMessages((prev) => [
        ...prev,
        {
          role: "tool",
          content: typeof input === "string" ? input : JSON.stringify(input, null, 2),
          toolName,
          timestamp: new Date(),
        },
      ]);
    });

    session.on("block_stop", () => {
      setCurrentTool(null);
    });

    session.on("message_stop", () => {
      // Flush current response to messages
      setCurrentResponse((current) => {
        if (current.trim()) {
          setMessages((prev) => [
            ...prev,
            {
              role: "assistant",
              content: current,
              timestamp: new Date(),
            },
          ]);
        }
        return "";
      });
      setIsWaiting(false);
    });

    session.on("session_id", (id: string) => {
      setSessionId(id);
    });

    session.on("error", (err: Error) => {
      setError(err.message);
      setIsWaiting(false);
    });

    session.on("close", (code: number) => {
      if (code !== 0) {
        setError(`Session ended with code ${code}`);
      }
      onComplete?.(code === 0);
    });

    session.on("stderr", (text: string) => {
      // Show stderr as system messages
      if (text.trim()) {
        setMessages((prev) => [
          ...prev,
          {
            role: "system",
            content: text,
            timestamp: new Date(),
          },
        ]);
      }
    });

    // Start the session
    session.start();

    return () => {
      session.stop();
    };
  }, [config, projectPath, initialPrompt, onComplete]);

  const sendMessage = useCallback((content: string) => {
    if (!sessionRef.current || !content.trim()) return;

    setMessages((prev) => [
      ...prev,
      {
        role: "user",
        content,
        timestamp: new Date(),
      },
    ]);
    setIsWaiting(true);
    setCurrentResponse("");
    sessionRef.current.sendMessage(content);
  }, []);

  const handleSubmit = useCallback(() => {
    if (input.trim() && !isWaiting) {
      sendMessage(input);
      setInput("");
    }
  }, [input, isWaiting, sendMessage]);

  useInput((char, key) => {
    if (key.escape) {
      if (sessionRef.current?.isActive()) {
        sessionRef.current.stop();
      }
      onBack();
    }
    if (key.ctrl && char === "c") {
      sessionRef.current?.kill();
      onBack();
    }
  });

  // Get messages to display (most recent)
  const displayMessages = messages.slice(-visibleMessages);

  return (
    <Box flexDirection="column" height={terminalHeight - 4}>
      {/* Header */}
      <Box marginBottom={1} flexDirection="column">
        <Box gap={2}>
          <Text bold color="cyan">Droid Chat</Text>
          {shard && <Text color="gray">Shard: {shard.title}</Text>}
          {sessionId && <Text color="gray" dimColor>Session: {sessionId.slice(0, 8)}...</Text>}
        </Box>
        <Text color="gray" dimColor>Model: {config.droids.model} | Auto: {config.droids.auto_level}</Text>
      </Box>

      {error && <StatusMessage type="error" message={error} />}

      {/* Messages */}
      <Box flexDirection="column" flexGrow={1} overflowY="hidden">
        {displayMessages.map((msg, i) => (
          <MessageBubble key={i} message={msg} />
        ))}

        {/* Current streaming response */}
        {currentResponse && (
          <Box marginY={1}>
            <Text color="green">◆ </Text>
            <Text>{currentResponse}</Text>
          </Box>
        )}

        {/* Current tool */}
        {currentTool && (
          <Box marginY={1}>
            <Spinner message={`Running: ${currentTool}`} />
          </Box>
        )}

        {/* Waiting indicator */}
        {isWaiting && !currentResponse && !currentTool && (
          <Box marginY={1}>
            <Spinner message="Thinking..." />
          </Box>
        )}
      </Box>

      {/* Input */}
      <Box marginTop={1} borderStyle="single" borderColor="cyan" paddingX={1}>
        <Text color="cyan">You: </Text>
        <TextInput
          value={input}
          onChange={setInput}
          onSubmit={handleSubmit}
          placeholder={isWaiting ? "Waiting for response..." : "Type a message..."}
          focus={!isWaiting}
        />
      </Box>

      {/* Footer */}
      <Box marginTop={1}>
        <Text color="gray">Enter to send • Esc to exit • Ctrl+C to force quit</Text>
      </Box>
    </Box>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const roleColors: Record<string, string> = {
    user: "blue",
    assistant: "green",
    system: "gray",
    tool: "yellow",
  };

  const roleIcons: Record<string, string> = {
    user: "◇",
    assistant: "◆",
    system: "●",
    tool: "⚙",
  };

  const color = roleColors[message.role] || "white";
  const icon = roleIcons[message.role] || "•";

  // Truncate long messages for display
  const maxLength = 500;
  const displayContent = message.content.length > maxLength
    ? message.content.slice(0, maxLength) + "..."
    : message.content;

  return (
    <Box marginY={0} flexDirection="column">
      <Box>
        <Text color={color as any}>{icon} </Text>
        {message.toolName && (
          <Text color="yellow" dimColor>[{message.toolName}] </Text>
        )}
        <Text color={color as any} wrap="wrap">
          {displayContent.split("\n").slice(0, 3).join("\n")}
          {displayContent.split("\n").length > 3 && "..."}
        </Text>
      </Box>
    </Box>
  );
}
