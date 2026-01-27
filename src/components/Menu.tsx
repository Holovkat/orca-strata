import React from "react";
import { Box, Text } from "ink";
import SelectInput from "ink-select-input";

export interface MenuItem {
  label: string;
  value: string;
  disabled?: boolean;
  hint?: string;
}

interface MenuProps {
  items: MenuItem[];
  onSelect: (value: string) => void;
  title?: string;
}

export function Menu({ items, onSelect, title }: MenuProps) {
  const selectItems = items
    .filter((item) => !item.disabled)
    .map((item) => ({
      key: item.value,
      label: item.hint ? `${item.label} - ${item.hint}` : item.label,
      value: item.value,
    }));

  return (
    <Box flexDirection="column">
      {title && (
        <Box marginBottom={1}>
          <Text bold color="white">
            {title}
          </Text>
        </Box>
      )}
      <SelectInput
        items={selectItems}
        onSelect={(item) => onSelect(item.value)}
        itemComponent={({ isSelected, label }) => (
          <Text color={isSelected ? "cyan" : "white"}>
            {isSelected ? "❯ " : "  "}
            {label}
          </Text>
        )}
      />
      <Box marginTop={1}>
        <Text color="gray">↑↓ Navigate • Enter Select • q Quit</Text>
      </Box>
    </Box>
  );
}
