import React, { useState, useEffect, useCallback } from "react";
import { Box, Text, useInput, useStdout } from "ink";
import TextInput from "ink-text-input";
import { Spinner } from "../components/Spinner.js";
import { StatusMessage } from "../components/StatusMessage.js";
import { invokeDroid } from "../lib/droid.js";
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
  role: "user" | "assistant" | "system";
  content: string;
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
  const [error, setError] = useState<string | null>(null);
  const [conversationHistory, setConversationHistory] = useState<string>("");
  const { stdout } = useStdout();

  // Calculate visible lines based on terminal height
  const terminalHeight = stdout?.rows || 24;
  const visibleMessages = Math.max(5, terminalHeight - 12);

  // Send initial prompt on mount
  useEffect(() => {
    if (initialPrompt) {
      sendMessage(initialPrompt);
    } else {
      setMessages([{
        role: "system",
        content: `Chat session started. Model: ${config.droids.model}`,
        timestamp: new Date(),
      }]);
    }
  }, []); // Only run once on mount

  const sendMessage = useCallback(async (content: string) => {
    if (!content.trim()) return;

    // Add user message
    const userMessage: ChatMessage = {
      role: "user",
      content,
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, userMessage]);
    setIsWaiting(true);
    setCurrentResponse("");
    setError(null);

    try {
      // Build context with conversation history
      const contextPrompt = conversationHistory
        ? `Previous conversation:\n${conversationHistory}\n\nUser: ${content}`
        : content;

      const result = await invokeDroid(
        {
          droid: "assistant", // Generic assistant mode
          prompt: contextPrompt,
          autoLevel: config.droids.auto_level,
          model: config.droids.model,
          cwd: projectPath,
        },
        config,
        (chunk) => {
          setCurrentResponse(prev => prev + chunk);
        }
      );

      // Add assistant message
      const assistantMessage: ChatMessage = {
        role: "assistant",
        content: result.output || currentResponse,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, assistantMessage]);

      // Update conversation history for context
      setConversationHistory(prev => 
        prev + `\nUser: ${content}\nAssistant: ${result.output || currentResponse}`
      );

      if (!result.success) {
        setError("Droid returned an error");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to get response");
      setMessages(prev => [...prev, {
        role: "system",
        content: `Error: ${err instanceof Error ? err.message : "Unknown error"}`,
        timestamp: new Date(),
      }]);
    } finally {
      setIsWaiting(false);
      setCurrentResponse("");
    }
  }, [config, projectPath, conversationHistory, currentResponse]);

  const handleSubmit = useCallback(() => {
    if (input.trim() && !isWaiting) {
      const message = input;
      setInput("");
      sendMessage(message);
    }
  }, [input, isWaiting, sendMessage]);

  useInput((char, key) => {
    if (key.escape) {
      onBack();
    }
    if (key.ctrl && char === "c") {
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
            <Text wrap="wrap">{currentResponse.slice(-500)}</Text>
          </Box>
        )}

        {/* Waiting indicator */}
        {isWaiting && !currentResponse && (
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
        />
      </Box>

      {/* Footer */}
      <Box marginTop={1}>
        <Text color="gray">Enter to send • Esc to exit</Text>
      </Box>
    </Box>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const roleColors: Record<string, string> = {
    user: "blue",
    assistant: "green",
    system: "gray",
  };

  const roleIcons: Record<string, string> = {
    user: "◇",
    assistant: "◆",
    system: "●",
  };

  const color = roleColors[message.role] || "white";
  const icon = roleIcons[message.role] || "•";

  // Truncate long messages for display
  const maxLength = 500;
  const displayContent = message.content.length > maxLength
    ? message.content.slice(0, maxLength) + "..."
    : message.content;

  // Show only first few lines
  const lines = displayContent.split("\n");
  const displayLines = lines.slice(0, 5);
  const hasMore = lines.length > 5;

  return (
    <Box marginY={0} flexDirection="column">
      <Box>
        <Text color={color as any}>{icon} </Text>
        <Text color={color as any} wrap="wrap">
          {displayLines.join("\n")}
          {hasMore && `\n... (${lines.length - 5} more lines)`}
        </Text>
      </Box>
    </Box>
  );
}
