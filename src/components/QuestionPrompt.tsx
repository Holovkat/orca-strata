import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import SelectInput from "ink-select-input";

interface QuestionPromptProps {
  question: string;
  type: "text" | "select" | "confirm";
  options?: string[];
  defaultValue?: string;
  onAnswer: (answer: string) => void;
  onCancel?: () => void;
}

export function QuestionPrompt({
  question,
  type,
  options = [],
  defaultValue = "",
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
