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
  onCancel?: () => void;
  title?: string;
  onKeyPress?: (key: string, selectedValue: string) => void;
  extraHints?: string;
  multiSelect?: boolean;
  selectedValues?: Set<string>;
  onToggleSelect?: (value: string) => void;
}

export function Menu({ items, onSelect, onCancel, title, onKeyPress, extraHints, multiSelect, selectedValues, onToggleSelect }: MenuProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const enabledItems = items.filter((item) => !item.disabled);
  
  // Build a map from enabled index to full item list index for rendering
  const enabledIndices = items
    .map((item, i) => (!item.disabled ? i : -1))
    .filter((i) => i !== -1);

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
    } else if (key.escape && onCancel) {
      onCancel();
    } else if (input === " " && multiSelect && onToggleSelect) {
      // Space toggles selection in multi-select mode
      const item = enabledItems[selectedIndex];
      if (item) {
        onToggleSelect(item.value);
      }
    } else if (onKeyPress && input && !key.ctrl && !key.meta) {
      // Pass custom key presses to handler
      const item = enabledItems[selectedIndex];
      if (item) {
        onKeyPress(input, item.value);
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
      {items.map((item, index) => {
        // For disabled items (dividers), render without selection indicator
        if (item.disabled) {
          return (
            <Box key={item.value} paddingX={1}>
              <Text color="gray" dimColor>
                {"   "}{item.label}
              </Text>
            </Box>
          );
        }
        
        // Find which enabled index this corresponds to
        const enabledIndex = enabledIndices.indexOf(index);
        const isSelected = enabledIndex === selectedIndex;
        const isChecked = multiSelect && selectedValues?.has(item.value);
        const label = item.hint ? `${item.label} - ${item.hint}` : item.label;
        
        // Multi-select checkbox prefix
        const checkbox = multiSelect ? (isChecked ? "[x] " : "[ ] ") : "";
        
        return (
          <Box key={item.value} paddingX={1}>
            <Text color={isSelected ? "cyan" : isChecked ? "green" : "white"}>
              {isSelected ? "❯ " : "  "}
              {checkbox}
              {label}
            </Text>
          </Box>
        );
      })}
      <Box marginTop={1}>
        <Text color="gray">
          ↑↓ Navigate • Enter Select
          {multiSelect ? " • Space Toggle" : ""}
          {onCancel ? " • Esc Back" : ""}
          {extraHints ? ` • ${extraHints}` : ""} • q Quit
        </Text>
      </Box>
    </Box>
  );
}
