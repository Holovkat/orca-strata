import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import SelectInput from "ink-select-input";
import { MultilineInput } from "ink-multiline-input";

interface QuestionPromptProps {
  question: string;
  type: "text" | "multiline" | "select" | "confirm";
  options?: string[];
  defaultValue?: string;
  rows?: number;
  onAnswer: (answer: string) => void;
  onCancel?: () => void;
}

export function QuestionPrompt({
  question,
  type,
  options = [],
  defaultValue = "",
  rows = 10,
  onAnswer,
  onCancel,
}: QuestionPromptProps) {
  const [value, setValue] = useState(defaultValue);

  useInput((input, key) => {
    if (key.escape && onCancel) {
      onCancel();
    }
  });

  if (type === "confirm") {
    return (
      <Box flexDirection="column">
        <Box marginBottom={1}>
          <Text bold color="yellow">
            ? {question}
          </Text>
        </Box>
        <SelectInput
          items={[
            { label: "Yes", value: "yes" },
            { label: "No", value: "no" },
          ]}
          onSelect={(item) => onAnswer(item.value)}
          itemComponent={({ isSelected, label }) => (
            <Text color={isSelected ? "cyan" : "white"}>
              {isSelected ? "❯ " : "  "}
              {label}
            </Text>
          )}
        />
      </Box>
    );
  }

  if (type === "select" && options.length > 0) {
    const selectItems = options.map((opt) => ({ label: opt, value: opt }));
    return (
      <Box flexDirection="column">
        <Box marginBottom={1}>
          <Text bold color="yellow">
            ? {question}
          </Text>
        </Box>
        <SelectInput
          items={selectItems}
          onSelect={(item) => onAnswer(item.value)}
          itemComponent={({ isSelected, label }) => (
            <Text color={isSelected ? "cyan" : "white"}>
              {isSelected ? "❯ " : "  "}
              {label}
            </Text>
          )}
        />
      </Box>
    );
  }

  // Multiline text input
  if (type === "multiline") {
    return (
      <Box flexDirection="column">
        <Box marginBottom={1}>
          <Text bold color="yellow">
            ? {question}
          </Text>
        </Box>
        <Box
          borderStyle="single"
          borderColor="cyan"
          paddingX={1}
          flexDirection="column"
        >
          <MultilineInput
            value={value}
            onChange={setValue}
            onSubmit={onAnswer}
            rows={rows}
            placeholder={defaultValue || "Type your answer (multiple lines)..."}
            focus={true}
            showCursor={true}
          />
        </Box>
        <Box marginTop={1}>
          <Text color="gray">Ctrl+Enter to submit • Esc to cancel • Arrow keys to navigate</Text>
        </Box>
      </Box>
    );
  }

  // Single-line text input
  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold color="yellow">
          ? {question}
        </Text>
      </Box>
      <Box>
        <Text color="cyan">❯ </Text>
        <TextInput
          value={value}
          onChange={setValue}
          onSubmit={() => onAnswer(value)}
          placeholder={defaultValue || "Type your answer..."}
        />
      </Box>
      <Box marginTop={1}>
        <Text color="gray">Enter to submit • Esc to cancel</Text>
      </Box>
    </Box>
  );
}
