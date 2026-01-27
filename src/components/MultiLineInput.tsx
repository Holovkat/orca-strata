import React, { useState, useEffect } from "react";
import { Box, Text, useInput, useStdout } from "ink";
import { join, relative } from "path";

interface MultiLineInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  onCancel?: () => void;
  placeholder?: string;
  minHeight?: number;
  projectPath?: string; // For @ file references
}

interface FileEntry {
  name: string;
  path: string;
  type: "file" | "folder";
}

export function MultiLineInput({
  value,
  onChange,
  onSubmit,
  onCancel,
  placeholder = "Type here...",
  minHeight = 3,
  projectPath,
}: MultiLineInputProps) {
  const [cursorPos, setCursorPos] = useState(value.length);
  const { stdout } = useStdout();
  const terminalWidth = stdout?.columns || 80;
  
  // @ mention state
  const [showFilePicker, setShowFilePicker] = useState(false);
  const [fileSearchQuery, setFileSearchQuery] = useState("");
  const [fileEntries, setFileEntries] = useState<FileEntry[]>([]);
  const [filteredEntries, setFilteredEntries] = useState<FileEntry[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [currentDir, setCurrentDir] = useState("");
  const [filePickerLoading, setFilePickerLoading] = useState(false);
  const [filePickerError, setFilePickerError] = useState("");

  // Load files when file picker is shown
  useEffect(() => {
    if (!showFilePicker || !projectPath) return;
    
    let cancelled = false;
    
    const loadFiles = async () => {
      setFilePickerLoading(true);
      setFilePickerError("");
      
      try {
        const { readdir, stat } = await import("fs/promises");
        const targetDir = currentDir ? join(projectPath, currentDir) : projectPath;
        const entries = await readdir(targetDir);
        
        if (cancelled) return;
        
        const fileList: FileEntry[] = [];
        
        // Add parent directory option if not at root
        if (currentDir) {
          fileList.push({
            name: "..",
            path: join(currentDir, ".."),
            type: "folder",
          });
        }
        
        // Limit entries to prevent freezing on large directories
        const maxEntries = 100;
        let count = 0;
        
        for (const entry of entries) {
          if (count >= maxEntries) break;
          if (entry.startsWith(".") && entry !== "..") continue; // Skip hidden files
          
          const fullPath = join(targetDir, entry);
          const stats = await stat(fullPath).catch(() => null);
          
          if (cancelled) return;
          
          if (stats) {
            fileList.push({
              name: entry,
              path: currentDir ? join(currentDir, entry) : entry,
              type: stats.isDirectory() ? "folder" : "file",
            });
            count++;
          }
        }
        
        // Sort: folders first, then files
        fileList.sort((a, b) => {
          if (a.name === "..") return -1;
          if (b.name === "..") return 1;
          if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
        
        if (!cancelled) {
          setFileEntries(fileList);
          setFilteredEntries(fileList);
          setSelectedIndex(0);
          setFilePickerLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setFileEntries([]);
          setFilteredEntries([]);
          setFilePickerError(err instanceof Error ? err.message : "Failed to load files");
          setFilePickerLoading(false);
        }
      }
    };
    
    loadFiles();
    
    return () => { cancelled = true; };
  }, [showFilePicker, projectPath, currentDir]);

  // Filter entries based on search query
  useEffect(() => {
    if (!fileSearchQuery) {
      setFilteredEntries(fileEntries);
    } else {
      const query = fileSearchQuery.toLowerCase();
      setFilteredEntries(
        fileEntries.filter(e => e.name.toLowerCase().includes(query))
      );
    }
    setSelectedIndex(0);
  }, [fileSearchQuery, fileEntries]);

  useInput((input, key) => {
    // File picker mode
    if (showFilePicker) {
      if (key.escape) {
        setShowFilePicker(false);
        setFileSearchQuery("");
        setCurrentDir("");
        return;
      }
      
      if (key.upArrow) {
        setSelectedIndex(Math.max(0, selectedIndex - 1));
        return;
      }
      
      if (key.downArrow) {
        setSelectedIndex(Math.min(filteredEntries.length - 1, selectedIndex + 1));
        return;
      }
      
      if (key.return) {
        const selected = filteredEntries[selectedIndex];
        if (selected) {
          if (selected.type === "folder") {
            // Navigate into folder
            if (selected.name === "..") {
              const parts = currentDir.split("/").filter(Boolean);
              parts.pop();
              setCurrentDir(parts.join("/"));
            } else {
              setCurrentDir(selected.path);
            }
            setFileSearchQuery("");
          } else {
            // Insert file reference
            const reference = `@file:${selected.path}`;
            const newValue = value.slice(0, cursorPos) + reference + value.slice(cursorPos);
            onChange(newValue);
            setCursorPos(cursorPos + reference.length);
            setShowFilePicker(false);
            setFileSearchQuery("");
            setCurrentDir("");
          }
        }
        return;
      }
      
      if (key.backspace) {
        setFileSearchQuery(prev => prev.slice(0, -1));
        return;
      }
      
      // Tab to insert folder reference
      if (key.tab) {
        const selected = filteredEntries[selectedIndex];
        if (selected && selected.type === "folder" && selected.name !== "..") {
          const reference = `@folder:${selected.path}/`;
          const newValue = value.slice(0, cursorPos) + reference + value.slice(cursorPos);
          onChange(newValue);
          setCursorPos(cursorPos + reference.length);
          setShowFilePicker(false);
          setFileSearchQuery("");
          setCurrentDir("");
        }
        return;
      }
      
      // Type to filter
      if (input && !key.ctrl && !key.meta) {
        setFileSearchQuery(prev => prev + input);
      }
      return;
    }

    // Normal input mode
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

    // @ triggers file picker
    if (input === "@" && projectPath) {
      setShowFilePicker(true);
      setFileSearchQuery("");
      setCurrentDir("");
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

  // File picker overlay
  if (showFilePicker) {
    const maxVisible = 10;
    const startIdx = Math.max(0, selectedIndex - Math.floor(maxVisible / 2));
    const visibleEntries = filteredEntries.slice(startIdx, startIdx + maxVisible);

    return (
      <Box flexDirection="column" width={terminalWidth - 4}>
        <Box 
          borderStyle="single" 
          borderColor="yellow" 
          flexDirection="column"
          paddingX={1}
        >
          <Box marginBottom={1}>
            <Text bold color="yellow">@ File Reference</Text>
            <Text color="gray"> - {currentDir || "/"}</Text>
          </Box>
          <Box marginBottom={1}>
            <Text color="cyan">Filter: </Text>
            <Text>{fileSearchQuery}</Text>
            <Text backgroundColor="white" color="black"> </Text>
          </Box>
          {filePickerLoading ? (
            <Text color="yellow">Loading...</Text>
          ) : filePickerError ? (
            <Text color="red">{filePickerError}</Text>
          ) : visibleEntries.length === 0 ? (
            <Text color="gray" dimColor>No files found</Text>
          ) : (
            visibleEntries.map((entry, i) => {
              const actualIdx = startIdx + i;
              const isSelected = actualIdx === selectedIndex;
              const icon = entry.type === "folder" ? "📁" : "📄";
              return (
                <Text key={entry.path}>
                  <Text color={isSelected ? "cyan" : "white"}>
                    {isSelected ? "❯ " : "  "}
                  </Text>
                  <Text>{icon} </Text>
                  <Text color={isSelected ? "cyan" : entry.type === "folder" ? "blue" : "white"}>
                    {entry.name}
                  </Text>
                </Text>
              );
            })
          )}
        </Box>
        <Box marginTop={0}>
          <Text color="gray" dimColor>
            ↑↓ navigate • Enter select/open • Tab folder ref • Esc cancel
          </Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" width={terminalWidth - 4}>
      <Box 
        borderStyle="single" 
        borderColor="cyan" 
        flexDirection="column"
        paddingX={1}
        minHeight={minHeight + 2}
        width="100%"
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
          Enter submit • Ctrl+J newline • @ reference file • Esc cancel
        </Text>
      </Box>
    </Box>
  );
}
