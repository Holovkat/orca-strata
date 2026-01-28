import React, { useState, useEffect, useCallback } from "react";
import { Box, Text, useInput, useStdout } from "ink";
import TextInput from "ink-text-input";
import { Spinner } from "../components/Spinner.js";
import { StatusMessage } from "../components/StatusMessage.js";
import { Markdown } from "../components/Markdown.js";
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
  const [expandedMessage, setExpandedMessage] = useState<number | null>(null);
  const { stdout } = useStdout();

  // Calculate visible lines based on terminal height
  const terminalHeight = stdout?.rows || 40;
  const maxLines = Math.max(15, terminalHeight - 10);

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
    setExpandedMessage(null);

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

  // Track focused message for Tab navigation
  const [focusedMessage, setFocusedMessage] = useState<number | null>(null);

  useInput((char, key) => {
    if (key.escape) {
      if (expandedMessage !== null) {
        setExpandedMessage(null);
        setFocusedMessage(null);
      } else if (focusedMessage !== null) {
        setFocusedMessage(null);
      } else {
        onBack();
      }
    }
    if (key.ctrl && char === "c") {
      onBack();
    }
    // Tab to cycle through messages (only when input is empty)
    if (key.tab && !key.shift && input === "" && !isWaiting && messages.length > 0) {
      if (focusedMessage === null) {
        setFocusedMessage(messages.length - 1);
      } else {
        setFocusedMessage((focusedMessage + 1) % messages.length);
      }
    }
    // Shift+Tab to cycle backwards
    if (key.tab && key.shift && input === "" && !isWaiting && messages.length > 0) {
      if (focusedMessage === null) {
        setFocusedMessage(messages.length - 1);
      } else {
        setFocusedMessage((focusedMessage - 1 + messages.length) % messages.length);
      }
    }
    // Enter to expand focused message (when not typing)
    if (key.return && input === "" && focusedMessage !== null && !isWaiting) {
      setExpandedMessage(focusedMessage);
    }
  });

  // If a message is expanded, show it full screen with markdown
  if (expandedMessage !== null && messages[expandedMessage]) {
    const msg = messages[expandedMessage];
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color="cyan">Full Message ({msg.role})</Text>
        <Text color="gray" dimColor>Press Esc to go back</Text>
        <Box marginTop={1} flexDirection="column">
          {msg.role === "assistant" ? (
            <Markdown>{msg.content}</Markdown>
          ) : (
            <Text color={msg.role === "user" ? "blue" : "gray"} wrap="wrap">
              {msg.content}
            </Text>
          )}
        </Box>
      </Box>
    );
  }

  // Show last few messages based on terminal height
  const recentMessages = messages.slice(-5);

  return (
    <Box flexDirection="column">
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
      <Box flexDirection="column" marginBottom={1}>
        {recentMessages.map((msg, i) => {
          const globalIdx = messages.length - recentMessages.length + i;
          return (
            <MessageBubble 
              key={globalIdx} 
              message={msg} 
              index={globalIdx + 1}
              maxLines={maxLines}
              focused={focusedMessage === globalIdx}
            />
          );
        })}

        {/* Current streaming response */}
        {currentResponse && (
          <Box marginY={1} flexDirection="column">
            <Text color="green">◆ Droid:</Text>
            <Box marginLeft={2}>
              <Markdown maxLines={20}>{currentResponse}</Markdown>
            </Box>
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
      <Box borderStyle="single" borderColor="cyan" paddingX={1}>
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
        <Text color="gray">
          {focusedMessage !== null 
            ? `Message ${focusedMessage + 1} selected • Enter expand • Tab next • Esc cancel`
            : "Enter send • Tab select message • Esc exit"}
        </Text>
      </Box>
    </Box>
  );
}

interface MessageBubbleProps {
  message: ChatMessage;
  index: number;
  maxLines: number;
  focused?: boolean;
}

function MessageBubble({ message, index, maxLines, focused }: MessageBubbleProps) {
  const roleIcons: Record<string, string> = {
    user: "◇",
    assistant: "◆",
    system: "●",
  };

  const icon = roleIcons[message.role] || "•";
  const linesToShow = Math.min(maxLines, 15);
  const focusIndicator = focused ? "▶ " : "";

  // For assistant messages, use markdown rendering
  if (message.role === "assistant") {
    const lines = message.content.split("\n");
    const hasMore = lines.length > linesToShow;
    
    return (
      <Box marginY={0} flexDirection="column">
        <Text color={focused ? "cyan" : "green"} bold={focused}>
          {focusIndicator}{icon} [{index}] Droid
        </Text>
        <Box marginLeft={2} flexDirection="column">
          <Markdown maxLines={linesToShow}>{message.content}</Markdown>
          {hasMore && (
            <Text color="yellow">{`... (${lines.length - linesToShow} more lines)`}</Text>
          )}
        </Box>
      </Box>
    );
  }

  // For user/system messages, simple text
  const baseColor = message.role === "user" ? "blue" : "gray";
  const color = focused ? "cyan" : baseColor;
  const label = message.role === "user" ? "You" : "System";
  const lines = message.content.split("\n");
  const displayLines = lines.slice(0, linesToShow);
  const hasMore = lines.length > linesToShow;

  return (
    <Box marginY={0} flexDirection="column">
      <Text color={color} bold={focused}>
        {focusIndicator}{icon} [{index}] {label}
      </Text>
      <Box marginLeft={2}>
        <Text color={baseColor} wrap="wrap">
          {displayLines.join("\n")}
          {hasMore && (
            <Text color="yellow">{`\n... (${lines.length - linesToShow} more lines)`}</Text>
          )}
        </Text>
      </Box>
    </Box>
  );
}
