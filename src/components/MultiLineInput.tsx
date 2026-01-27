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
  const [allEntries, setAllEntries] = useState<FileEntry[]>([]);
  const [filteredEntries, setFilteredEntries] = useState<FileEntry[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [filePickerLoading, setFilePickerLoading] = useState(false);

  // Resolve path with ~ expansion
  const resolvePath = (p: string): string => {
    if (p.startsWith("~/")) {
      return join(process.env.HOME || "", p.slice(2));
    }
    return p;
  };

  // Check if search query is an absolute path
  const isAbsolutePath = fileSearchQuery.startsWith("/") || fileSearchQuery.startsWith("~");
  const searchBasePath = isAbsolutePath ? resolvePath(fileSearchQuery) : projectPath;

  // Load files - either from project or from absolute path
  useEffect(() => {
    if (!showFilePicker) return;
    
    // For project search, only load once
    if (!isAbsolutePath && allEntries.length > 0) return;
    
    // For absolute paths, need a base path
    if (isAbsolutePath && !fileSearchQuery) return;
    
    let cancelled = false;
    
    const loadFiles = async () => {
      setFilePickerLoading(true);
      
      try {
        const { readdir, stat } = await import("fs/promises");
        const fileList: FileEntry[] = [];
        const maxEntries = 500;
        
        const ignoreDirs = new Set(["node_modules", ".git", "dist", "build", ".next", "coverage", "__pycache__", ".venv", "venv"]);
        
        // For absolute paths, list the directory contents
        if (isAbsolutePath) {
          const basePath = resolvePath(fileSearchQuery);
          
          // Check if it's a directory or partial path
          const stats = await stat(basePath).catch(() => null);
          
          if (stats?.isDirectory()) {
            // List directory contents
            const entries = await readdir(basePath);
            for (const entry of entries.slice(0, 50)) {
              if (entry.startsWith(".")) continue;
              const fullPath = join(basePath, entry);
              const entryStats = await stat(fullPath).catch(() => null);
              if (entryStats) {
                fileList.push({
                  name: entry,
                  path: join(fileSearchQuery, entry),
                  type: entryStats.isDirectory() ? "folder" : "file",
                });
              }
            }
          } else {
            // Partial path - list parent directory and filter
            const parentDir = basePath.substring(0, basePath.lastIndexOf("/")) || "/";
            const partial = basePath.substring(basePath.lastIndexOf("/") + 1).toLowerCase();
            
            const entries = await readdir(parentDir).catch(() => [] as string[]);
            for (const entry of entries) {
              if (entry.startsWith(".")) continue;
              if (partial && !entry.toLowerCase().startsWith(partial)) continue;
              
              const fullPath = join(parentDir, entry);
              const entryStats = await stat(fullPath).catch(() => null);
              if (entryStats) {
                const queryParent = fileSearchQuery.substring(0, fileSearchQuery.lastIndexOf("/") + 1);
                fileList.push({
                  name: entry,
                  path: queryParent + entry,
                  type: entryStats.isDirectory() ? "folder" : "file",
                });
              }
            }
          }
          
          fileList.sort((a, b) => {
            if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
            return a.name.localeCompare(b.name);
          });
          
          if (!cancelled) {
            setFilteredEntries(fileList.slice(0, 20));
            setSelectedIndex(0);
            setFilePickerLoading(false);
          }
          return;
        }
        
        // Project-relative search - scan recursively
        const scanDir = async (dir: string, relativePath: string) => {
          if (cancelled || fileList.length >= maxEntries) return;
          
          try {
            const entries = await readdir(dir);
            
            for (const entry of entries) {
              if (cancelled || fileList.length >= maxEntries) break;
              if (entry.startsWith(".")) continue;
              
              const fullPath = join(dir, entry);
              const relPath = relativePath ? `${relativePath}/${entry}` : entry;
              const stats = await stat(fullPath).catch(() => null);
              
              if (stats) {
                if (stats.isDirectory()) {
                  if (!ignoreDirs.has(entry)) {
                    fileList.push({ name: entry, path: relPath, type: "folder" });
                    await scanDir(fullPath, relPath);
                  }
                } else {
                  fileList.push({ name: entry, path: relPath, type: "file" });
                }
              }
            }
          } catch {
            // Ignore permission errors
          }
        };
        
        await scanDir(projectPath || ".", "");
        
        if (!cancelled) {
          fileList.sort((a, b) => a.path.localeCompare(b.path));
          setAllEntries(fileList);
          setFilteredEntries(fileList.slice(0, 20));
          setSelectedIndex(0);
          setFilePickerLoading(false);
        }
      } catch {
        if (!cancelled) {
          setAllEntries([]);
          setFilteredEntries([]);
          setFilePickerLoading(false);
        }
      }
    };
    
    loadFiles();
    
    return () => { cancelled = true; };
  }, [showFilePicker, projectPath, allEntries.length, isAbsolutePath, fileSearchQuery]);

  // Filter entries based on search query (fuzzy match on path) - only for project-relative searches
  useEffect(() => {
    // Skip for absolute paths - handled in the load effect
    if (isAbsolutePath) return;
    
    if (!fileSearchQuery) {
      setFilteredEntries(allEntries.slice(0, 20));
    } else {
      const query = fileSearchQuery.toLowerCase();
      const matches = allEntries.filter(e => 
        e.path.toLowerCase().includes(query) || 
        e.name.toLowerCase().includes(query)
      );
      setFilteredEntries(matches.slice(0, 20));
    }
    setSelectedIndex(0);
  }, [fileSearchQuery, allEntries, isAbsolutePath]);

  useInput((input, key) => {
    // File picker mode
    if (showFilePicker) {
      if (key.escape) {
        // First Esc closes file picker, returns to editing
        setShowFilePicker(false);
        setFileSearchQuery("");
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
          if (selected.type === "folder" && !key.ctrl) {
            // Enter on folder = drill down (same as Tab)
            const newQuery = selected.path.endsWith("/") ? selected.path : selected.path + "/";
            setFileSearchQuery(newQuery);
          } else {
            // Enter on file (or Ctrl+Enter on folder) = insert reference
            const prefix = selected.type === "folder" ? "@folder:" : "@file:";
            const reference = `${prefix}${selected.path}`;
            const newValue = value.slice(0, cursorPos) + reference + value.slice(cursorPos);
            onChange(newValue);
            setCursorPos(cursorPos + reference.length);
            setShowFilePicker(false);
            setFileSearchQuery("");
          }
        }
        return;
      }
      
      if (key.backspace || key.delete) {
        setFileSearchQuery(prev => prev.slice(0, -1));
        return;
      }
      
      // Tab to autocomplete selected item into search field
      if (key.tab) {
        const selected = filteredEntries[selectedIndex];
        if (selected) {
          // For folders, add trailing slash to continue browsing
          const newQuery = selected.type === "folder" 
            ? (selected.path.endsWith("/") ? selected.path : selected.path + "/")
            : selected.path;
          setFileSearchQuery(newQuery);
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
            <Text color="gray"> - {isAbsolutePath ? "browsing filesystem" : "type to search (~ or / for absolute path)"}</Text>
          </Box>
          <Box marginBottom={1}>
            <Text color="cyan">{isAbsolutePath ? "Path: " : "Search: "}</Text>
            <Text color="green">{fileSearchQuery}</Text>
            <Text backgroundColor="white" color="black"> </Text>
            {!isAbsolutePath && fileSearchQuery && <Text color="gray"> ({filteredEntries.length} matches)</Text>}
          </Box>
          {filePickerLoading ? (
            <Text color="yellow">{isAbsolutePath ? "Loading..." : "Scanning project files..."}</Text>
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
                    {entry.path}
                  </Text>
                </Text>
              );
            })
          )}
        </Box>
        <Box marginTop={0}>
          <Text color="gray" dimColor>
            ↑↓ nav • Tab/Enter expand • Enter select file • Ctrl+Enter select folder • Esc back
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
