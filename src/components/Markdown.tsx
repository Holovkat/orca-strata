import React from "react";
import { Text, Box } from "ink";

interface MarkdownProps {
  children: string;
  maxLines?: number;
}

/**
 * Simple markdown renderer for terminal
 * Supports: **bold**, *italic*, `code`, # headers, - lists, ```code blocks```
 */
export function Markdown({ children, maxLines }: MarkdownProps) {
  const lines = children.split("\n");
  const displayLines = maxLines ? lines.slice(0, maxLines) : lines;
  
  return (
    <Box flexDirection="column">
      {displayLines.map((line, i) => (
        <MarkdownLine key={i} line={line} />
      ))}
      {maxLines && lines.length > maxLines && (
        <Text color="gray" dimColor>... ({lines.length - maxLines} more lines)</Text>
      )}
    </Box>
  );
}

function MarkdownLine({ line }: { line: string }) {
  // Check for headers
  if (line.startsWith("### ")) {
    return <Text bold color="cyan">{line.slice(4)}</Text>;
  }
  if (line.startsWith("## ")) {
    return <Text bold color="yellow">{line.slice(3)}</Text>;
  }
  if (line.startsWith("# ")) {
    return <Text bold color="green">{line.slice(2)}</Text>;
  }
  
  // Check for bullet points
  if (line.match(/^[\s]*[-*]\s/)) {
    const indent = line.match(/^(\s*)/)?.[1] || "";
    const content = line.replace(/^[\s]*[-*]\s/, "");
    return (
      <Text>
        {indent}<Text color="cyan">• </Text>
        <InlineMarkdown text={content} />
      </Text>
    );
  }
  
  // Check for numbered lists
  if (line.match(/^[\s]*\d+\.\s/)) {
    const match = line.match(/^(\s*)(\d+)\.\s(.*)$/);
    if (match) {
      const [, indent = "", num, content = ""] = match;
      return (
        <Text>
          {indent}<Text color="cyan">{num}. </Text>
          <InlineMarkdown text={content} />
        </Text>
      );
    }
  }
  
  // Check for code block markers
  if (line.startsWith("```")) {
    const lang = line.slice(3);
    return <Text color="gray" dimColor>{lang ? `[${lang}]` : "---"}</Text>;
  }
  
  // Check for blockquotes
  if (line.startsWith("> ")) {
    return (
      <Text>
        <Text color="gray">│ </Text>
        <Text color="white" italic><InlineMarkdown text={line.slice(2)} /></Text>
      </Text>
    );
  }
  
  // Check for horizontal rules
  if (line.match(/^[-=_]{3,}$/)) {
    return <Text color="gray">────────────────────</Text>;
  }
  
  // Regular line with inline formatting
  return <InlineMarkdown text={line} />;
}

function InlineMarkdown({ text }: { text: string }) {
  // Parse inline markdown: **bold**, *italic*, `code`, [link](url)
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;
  
  while (remaining.length > 0) {
    // Check for inline code
    const codeMatch = remaining.match(/^`([^`]+)`/);
    if (codeMatch) {
      parts.push(
        <Text key={key++} backgroundColor="gray" color="white"> {codeMatch[1]} </Text>
      );
      remaining = remaining.slice(codeMatch[0].length);
      continue;
    }
    
    // Check for bold
    const boldMatch = remaining.match(/^\*\*([^*]+)\*\*/);
    if (boldMatch) {
      parts.push(
        <Text key={key++} bold color="white">{boldMatch[1]}</Text>
      );
      remaining = remaining.slice(boldMatch[0].length);
      continue;
    }
    
    // Check for italic
    const italicMatch = remaining.match(/^\*([^*]+)\*/);
    if (italicMatch) {
      parts.push(
        <Text key={key++} italic color="white">{italicMatch[1]}</Text>
      );
      remaining = remaining.slice(italicMatch[0].length);
      continue;
    }
    
    // Check for links [text](url)
    const linkMatch = remaining.match(/^\[([^\]]+)\]\(([^)]+)\)/);
    if (linkMatch) {
      parts.push(
        <Text key={key++} color="blue" underline>{linkMatch[1]}</Text>
      );
      remaining = remaining.slice(linkMatch[0].length);
      continue;
    }
    
    // Find next special character
    const nextSpecial = remaining.search(/[`*\[]/);
    if (nextSpecial === -1) {
      // No more special chars, add rest as plain text
      parts.push(<Text key={key++}>{remaining}</Text>);
      break;
    } else if (nextSpecial === 0) {
      // Special char at start but didn't match patterns, treat as plain
      parts.push(<Text key={key++}>{remaining[0]}</Text>);
      remaining = remaining.slice(1);
    } else {
      // Add text before special char
      parts.push(<Text key={key++}>{remaining.slice(0, nextSpecial)}</Text>);
      remaining = remaining.slice(nextSpecial);
    }
  }
  
  return <Text>{parts}</Text>;
}
