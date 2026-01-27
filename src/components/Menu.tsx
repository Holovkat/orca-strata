import React, { useRef, useState } from "react";
import { Box, Text, useInput } from "ink";
import type { DOMElement } from "ink";
import { useOnMouseClick, useOnMouseHover } from "@zenobius/ink-mouse";

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
      {enabledItems.map((item, index) => (
        <MenuItemRow
          key={item.value}
          item={item}
          isSelected={index === selectedIndex}
          onSelect={() => onSelect(item.value)}
          onHover={() => setSelectedIndex(index)}
        />
      ))}
      <Box marginTop={1}>
        <Text color="gray">↑↓ Navigate • Enter/Click Select • q Quit</Text>
      </Box>
    </Box>
  );
}

interface MenuItemRowProps {
  item: MenuItem;
  isSelected: boolean;
  onSelect: () => void;
  onHover: () => void;
}

function MenuItemRow({ item, isSelected, onSelect, onHover }: MenuItemRowProps) {
  const ref = useRef<DOMElement>(null);
  const [isHovering, setIsHovering] = useState(false);
  const [isClicking, setIsClicking] = useState(false);

  // Cast to satisfy ink-mouse's stricter type (doesn't allow null)
  const mouseRef = ref as React.RefObject<DOMElement>;

  useOnMouseHover(mouseRef, (hovering) => {
    setIsHovering(hovering);
    if (hovering) {
      onHover();
    }
  });

  useOnMouseClick(mouseRef, (clicking) => {
    setIsClicking(clicking);
    if (clicking) {
      onSelect();
    }
  });

  const getColor = () => {
    if (isClicking) return "green";
    if (isSelected || isHovering) return "cyan";
    return "white";
  };

  const label = item.hint ? `${item.label} - ${item.hint}` : item.label;

  return (
    <Box ref={ref} paddingX={1}>
      <Text color={getColor()}>
        {isSelected ? "❯ " : "  "}
        {label}
      </Text>
    </Box>
  );
}
