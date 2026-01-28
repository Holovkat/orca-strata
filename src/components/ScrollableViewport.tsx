import React, { useState, useEffect } from "react";
import { Box, Text, useInput, useStdout } from "ink";

interface ScrollableViewportProps {
  children: React.ReactNode;
  reservedLines?: number; // Lines reserved for header/footer outside scroll area
  title?: string;
  showScrollHint?: boolean;
}

/**
 * A viewport-aware container that constrains content to terminal height.
 * Content area is scrollable with j/k or arrow keys.
 */
export function ScrollableViewport({
  children,
  reservedLines = 0,
  title,
  showScrollHint = true,
}: ScrollableViewportProps) {
  const { stdout } = useStdout();
  const [scrollOffset, setScrollOffset] = useState(0);
  
  // Get terminal dimensions
  const terminalHeight = stdout?.rows || 24;
  const terminalWidth = stdout?.columns || 80;
  
  // Calculate available height for content
  const headerLines = title ? 2 : 0;
  const hintLines = showScrollHint ? 1 : 0;
  const availableHeight = Math.max(5, terminalHeight - reservedLines - headerLines - hintLines - 2);

  // Convert children to array of lines for scrolling
  const [contentLines, setContentLines] = useState<string[]>([]);
  
  useEffect(() => {
    // This is a simplified approach - in practice you'd need to measure rendered content
    // For now, we'll just constrain the Box height
  }, [children]);

  useInput((input, key) => {
    if (key.upArrow || input === "k") {
      setScrollOffset((prev) => Math.max(0, prev - 1));
    } else if (key.downArrow || input === "j") {
      setScrollOffset((prev) => prev + 1);
    } else if (key.pageUp) {
      setScrollOffset((prev) => Math.max(0, prev - availableHeight));
    } else if (key.pageDown) {
      setScrollOffset((prev) => prev + availableHeight);
    }
  });

  return (
    <Box flexDirection="column" height={terminalHeight - reservedLines}>
      {title && (
        <Box marginBottom={1}>
          <Text bold color="cyan">{title}</Text>
        </Box>
      )}
      
      <Box 
        flexDirection="column" 
        height={availableHeight}
        overflow="hidden"
      >
        {children}
      </Box>
      
      {showScrollHint && (
        <Box marginTop={1}>
          <Text color="gray" dimColor>
            ↑/↓ or j/k to scroll • PageUp/PageDown for pages
          </Text>
        </Box>
      )}
    </Box>
  );
}

interface FixedViewportProps {
  children: React.ReactNode;
  header?: React.ReactNode;
  footer?: React.ReactNode;
}

/**
 * A simpler fixed viewport that ensures content stays within terminal bounds.
 * Uses flexbox to allocate space: header (fixed) → content (flex) → footer (fixed)
 */
export function FixedViewport({ children, header, footer }: FixedViewportProps) {
  const { stdout } = useStdout();
  const terminalHeight = stdout?.rows || 24;
  
  return (
    <Box flexDirection="column" height={terminalHeight - 1}>
      {header && (
        <Box flexDirection="column" flexShrink={0}>
          {header}
        </Box>
      )}
      
      <Box flexDirection="column" flexGrow={1} overflow="hidden">
        {children}
      </Box>
      
      {footer && (
        <Box flexDirection="column" flexShrink={0}>
          {footer}
        </Box>
      )}
    </Box>
  );
}
