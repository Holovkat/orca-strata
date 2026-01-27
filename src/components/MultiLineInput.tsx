import React, { useState, useCallback } from "react";
import { Box, Text, useInput } from "ink";

interface MultiLineInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  onCancel?: () => void;
  placeholder?: string;
  minHeight?: number;
}

export function MultiLineInput({
  value,
  onChange,
  onSubmit,
  onCancel,
  placeholder = "Type here...",
  minHeight = 3,
}: MultiLineInputProps) {
  const [cursorPos, setCursorPos] = useState(value.length);

  useInput((input, key) => {
    if (key.escape) {
      onCancel?.();
      return;
    }

    if (key.return) {
      // Enter submits
      if (value.trim()) {
        onSubmit(value);
      }
      return;
    }

    // Ctrl+J inserts newline
    if (key.ctrl && input === "j") {
      const newValue = value.slice(0, cursorPos) + "\n" + value.slice(cursorPos);
      onChange(newValue);
      setCursorPos(cursorPos + 1);
      return;
    }

    // Backspace
    if (key.backspace || key.delete) {
      if (cursorPos > 0) {
        const newValue = value.slice(0, cursorPos - 1) + value.slice(cursorPos);
        onChange(newValue);
        setCursorPos(cursorPos - 1);
      }
      return;
    }

    // Arrow keys for cursor movement
    if (key.leftArrow) {
      setCursorPos(Math.max(0, cursorPos - 1));
      return;
    }
    if (key.rightArrow) {
      setCursorPos(Math.min(value.length, cursorPos + 1));
      return;
    }
    if (key.upArrow) {
      // Move to previous line
      const lines = value.slice(0, cursorPos).split("\n");
      if (lines.length > 1) {
        const currentLine = lines[lines.length - 1] || "";
        const prevLine = lines[lines.length - 2] || "";
        const currentLineStart = cursorPos - currentLine.length;
        const prevLineStart = currentLineStart - 1 - prevLine.length;
        const posInLine = currentLine.length;
        setCursorPos(prevLineStart + 1 + Math.min(posInLine, prevLine.length));
      }
      return;
    }
    if (key.downArrow) {
      // Move to next line
      const beforeCursor = value.slice(0, cursorPos);
      const afterCursor = value.slice(cursorPos);
      const currentLinePos = beforeCursor.length - beforeCursor.lastIndexOf("\n") - 1;
      const nextNewline = afterCursor.indexOf("\n");
      if (nextNewline !== -1) {
        const nextLineLength = afterCursor.slice(nextNewline + 1).indexOf("\n");
        const actualNextLineLength = nextLineLength === -1 
          ? afterCursor.length - nextNewline - 1 
          : nextLineLength;
        setCursorPos(cursorPos + nextNewline + 1 + Math.min(currentLinePos, actualNextLineLength));
      }
      return;
    }

    // Regular character input
    if (input && !key.ctrl && !key.meta) {
      const newValue = value.slice(0, cursorPos) + input + value.slice(cursorPos);
      onChange(newValue);
      setCursorPos(cursorPos + input.length);
    }
  });

  // Render the text with cursor
  const lines = value.split("\n");
  const displayLines = Math.max(lines.length, minHeight);
  
  // Calculate cursor position in terms of line and column
  let charCount = 0;
  let cursorLine = 0;
  let cursorCol = 0;
  for (let i = 0; i < lines.length; i++) {
    const lineLength = lines[i]?.length || 0;
    if (charCount + lineLength >= cursorPos) {
      cursorLine = i;
      cursorCol = cursorPos - charCount;
      break;
    }
    charCount += lineLength + 1; // +1 for newline
  }

  return (
    <Box flexDirection="column">
      <Box 
        borderStyle="single" 
        borderColor="cyan" 
        flexDirection="column"
        paddingX={1}
        minHeight={minHeight + 2}
      >
        {lines.length === 0 || (lines.length === 1 && lines[0] === "") ? (
          <Text color="gray" dimColor>{placeholder}</Text>
        ) : (
          lines.map((line, i) => (
            <Text key={i}>
              {i === cursorLine ? (
                <>
                  <Text>{line.slice(0, cursorCol)}</Text>
                  <Text backgroundColor="white" color="black">
                    {line[cursorCol] || " "}
                  </Text>
                  <Text>{line.slice(cursorCol + 1)}</Text>
                </>
              ) : (
                line || " "
              )}
            </Text>
          ))
        )}
        {/* Pad with empty lines if needed */}
        {Array.from({ length: Math.max(0, minHeight - lines.length) }).map((_, i) => (
          <Text key={`pad-${i}`}> </Text>
        ))}
      </Box>
      <Box marginTop={0}>
        <Text color="gray" dimColor>
          Enter submit • Ctrl+J newline • Esc cancel
        </Text>
      </Box>
    </Box>
  );
}
