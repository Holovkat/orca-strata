import React, { useState, useEffect, useCallback, useRef } from "react";
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
  const [scrollOffset, setScrollOffset] = useState(0);
  const { stdout } = useStdout();

  const terminalHeight = stdout?.rows || 40;
  // Reserve space for header (3), input (3), footer (1), margins
  const chatAreaHeight = Math.max(10, terminalHeight - 10);

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
  }, []);

  const sendMessage = useCallback(async (content: string) => {
    if (!content.trim()) return;

    const userMessage: ChatMessage = {
      role: "user",
      content,
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, userMessage]);
    setIsWaiting(true);
    setCurrentResponse("");
    setError(null);
    setScrollOffset(0); // Reset scroll to bottom on new message

    try {
      const contextPrompt = conversationHistory
        ? `Previous conversation:\n${conversationHistory}\n\nUser: ${content}`
        : content;

      const result = await invokeDroid(
        {
          droid: "assistant",
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

      const assistantMessage: ChatMessage = {
        role: "assistant",
        content: result.output || currentResponse,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, assistantMessage]);

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

  // Build full chat content as lines
  const buildChatLines = (): string[] => {
    const lines: string[] = [];
    
    for (const msg of messages) {
      const icon = msg.role === "user" ? "◇" : msg.role === "assistant" ? "◆" : "●";
      const label = msg.role === "user" ? "You" : msg.role === "assistant" ? "Droid" : "System";
      const color = msg.role === "user" ? "blue" : msg.role === "assistant" ? "green" : "gray";
      
      lines.push(`${icon} ${label}:`);
      const contentLines = msg.content.split("\n");
      for (const line of contentLines) {
        lines.push(`  ${line}`);
      }
      lines.push(""); // Empty line between messages
    }
    
    // Add current streaming response
    if (currentResponse) {
      lines.push("◆ Droid:");
      const responseLines = currentResponse.split("\n");
      for (const line of responseLines) {
        lines.push(`  ${line}`);
      }
    }
    
    return lines;
  };

  const chatLines = buildChatLines();
  const totalLines = chatLines.length;
  const maxScroll = Math.max(0, totalLines - chatAreaHeight);

  useInput((char, key) => {
    if (key.escape) {
      onBack();
    }
    if (key.ctrl && char === "c") {
      onBack();
    }
    // Scroll up/down with arrow keys (when input is empty)
    if (input === "" && !isWaiting) {
      if (key.upArrow) {
        setScrollOffset(prev => Math.min(prev + 3, maxScroll));
      }
      if (key.downArrow) {
        setScrollOffset(prev => Math.max(prev - 3, 0));
      }
      // Page up/down
      if (key.pageUp) {
        setScrollOffset(prev => Math.min(prev + chatAreaHeight, maxScroll));
      }
      if (key.pageDown) {
        setScrollOffset(prev => Math.max(prev - chatAreaHeight, 0));
      }
    }
  });

  // Calculate visible lines (from bottom, with scroll offset)
  const startLine = Math.max(0, totalLines - chatAreaHeight - scrollOffset);
  const visibleLines = chatLines.slice(startLine, startLine + chatAreaHeight);

  return (
    <Box flexDirection="column" height={terminalHeight - 1}>
      {/* Header */}
      <Box marginBottom={1} flexDirection="column" flexShrink={0}>
        <Box gap={2}>
          <Text bold color="cyan">Droid Chat</Text>
          {shard && <Text color="gray">Shard: {shard.title}</Text>}
        </Box>
        <Text color="gray" dimColor>Model: {config.droids.model} | Auto: {config.droids.auto_level}</Text>
      </Box>

      {error && (
        <Box flexShrink={0}>
          <StatusMessage type="error" message={error} />
        </Box>
      )}

      {/* Scrollable Chat Area */}
      <Box flexDirection="column" flexGrow={1} overflow="hidden">
        {scrollOffset > 0 && (
          <Text color="yellow" dimColor>↑ {scrollOffset} more lines above (↑/↓ to scroll)</Text>
        )}
        <Box flexDirection="column" flexGrow={1}>
          {visibleLines.map((line, i) => {
            // Color code based on line content
            let color: string | undefined;
            if (line.startsWith("◇ You:")) color = "blue";
            else if (line.startsWith("◆ Droid:")) color = "green";
            else if (line.startsWith("● System:")) color = "gray";
            else if (line.startsWith("  ")) color = undefined; // Content lines
            
            return (
              <Text key={startLine + i} color={color} wrap="truncate">
                {line}
              </Text>
            );
          })}
        </Box>
        {startLine > 0 && scrollOffset < maxScroll && (
          <Text color="yellow" dimColor>↓ more below</Text>
        )}
        
        {/* Waiting indicator */}
        {isWaiting && !currentResponse && (
          <Box flexShrink={0}>
            <Spinner message="Thinking..." />
          </Box>
        )}
      </Box>

      {/* Input */}
      <Box borderStyle="single" borderColor="cyan" paddingX={1} flexShrink={0}>
        <Text color="cyan">You: </Text>
        <TextInput
          value={input}
          onChange={setInput}
          onSubmit={handleSubmit}
          placeholder={isWaiting ? "Waiting for response..." : "Type a message..."}
        />
      </Box>

      {/* Footer */}
      <Box flexShrink={0}>
        <Text color="gray">Enter send • ↑↓ scroll • Esc exit</Text>
      </Box>
    </Box>
  );
}
