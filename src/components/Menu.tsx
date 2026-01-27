import React, { useState } from "react";
import { Box, Text, useInput } from "ink";

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
  const [selectedIndex, setSelectedIndex] = useState(0);
  const enabledItems = items.filter((item) => !item.disabled);

  useInput((input, key) => {
    if (key.upArrow) {
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : enabledItems.length - 1));
    } else if (key.downArrow) {
      setSelectedIndex((prev) => (prev < enabledItems.length - 1 ? prev + 1 : 0));
    } else if (key.return) {
      const item = enabledItems[selectedIndex];
      if (item) {
        onSelect(item.value);
      }
    }
  });

  return (
    <Box flexDirection="column">
      {title && (
        <Box marginBottom={1}>
          <Text bold color="white">
            {title}
          </Text>
        </Box>
      )}
      {enabledItems.map((item, index) => {
        const isSelected = index === selectedIndex;
        const label = item.hint ? `${item.label} - ${item.hint}` : item.label;
        
        return (
          <Box key={item.value} paddingX={1}>
            <Text color={isSelected ? "cyan" : "white"}>
              {isSelected ? "❯ " : "  "}
              {label}
            </Text>
          </Box>
        );
      })}
      <Box marginTop={1}>
        <Text color="gray">↑↓ Navigate • Enter Select • q Quit</Text>
      </Box>
    </Box>
  );
}
