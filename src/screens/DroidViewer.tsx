import React, { useState } from "react";
import { Box, Text, useInput, useStdout } from "ink";
import { Markdown } from "../components/Markdown.js";
import type { RunningDroid } from "../lib/types.js";

interface DroidViewerProps {
  runningDroids: RunningDroid[];
  selectedDroidId?: string;
  onBack: () => void;
  onSelectDroid: (shardId: string) => void;
}

export function DroidViewer({
  runningDroids,
  selectedDroidId,
  onBack,
  onSelectDroid,
}: DroidViewerProps) {
  const { stdout } = useStdout();
  const terminalHeight = stdout?.rows || 24;
  const terminalWidth = stdout?.columns || 80;
  
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [viewMode, setViewMode] = useState<"list" | "output">(selectedDroidId ? "output" : "list");

  const selectedDroid = selectedDroidId 
    ? runningDroids.find(d => d.shardId === selectedDroidId)
    : runningDroids[selectedIndex];

  useInput((input, key) => {
    if (key.escape) {
      if (viewMode === "output") {
        setViewMode("list");
      } else {
        onBack();
      }
    }
    
    if (viewMode === "list") {
      if (key.upArrow) {
        setSelectedIndex(prev => Math.max(0, prev - 1));
      } else if (key.downArrow) {
        setSelectedIndex(prev => Math.min(runningDroids.length - 1, prev + 1));
      } else if (key.return && runningDroids[selectedIndex]) {
        onSelectDroid(runningDroids[selectedIndex].shardId);
        setViewMode("output");
      }
    }
  });

  if (runningDroids.length === 0) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color="cyan">Running Droids</Text>
        <Box marginY={1}>
          <Text color="gray">No droids are currently running.</Text>
        </Box>
        <Text color="gray">Esc to go back</Text>
      </Box>
    );
  }

  if (viewMode === "output" && selectedDroid) {
    const statusColor = selectedDroid.status === "running" ? "yellow" 
      : selectedDroid.status === "complete" ? "green" 
      : "red";
    
    const outputLines = selectedDroid.output.split("\n");
    const maxOutputLines = terminalHeight - 8;
    const displayOutput = outputLines.slice(-maxOutputLines).join("\n");

    return (
      <Box flexDirection="column" height={terminalHeight - 1}>
        <Box marginBottom={1} flexShrink={0}>
          <Text bold color="cyan">Droid Output: </Text>
          <Text color="white">{selectedDroid.shardTitle}</Text>
          <Text color="gray"> ({selectedDroid.droid})</Text>
        </Box>
        
        <Box marginBottom={1} flexShrink={0}>
          <Text color={statusColor}>
            ● {selectedDroid.status.toUpperCase()}
          </Text>
          {selectedDroid.status === "running" && (
            <Text color="gray"> - running for {formatDuration(selectedDroid.startedAt)}</Text>
          )}
          {selectedDroid.completedAt && (
            <Text color="gray"> - completed in {formatDuration(selectedDroid.startedAt, selectedDroid.completedAt)}</Text>
          )}
        </Box>

        <Box flexGrow={1} flexDirection="column" overflow="hidden">
          <Markdown maxLines={maxOutputLines}>{displayOutput}</Markdown>
        </Box>

        <Box marginTop={1} flexShrink={0}>
          <Text color="gray">
            Esc back to list • Output: {outputLines.length} lines
            {selectedDroid.status === "running" && " • Droid still running in background"}
          </Text>
        </Box>
      </Box>
    );
  }

  // List view
  return (
    <Box flexDirection="column" height={terminalHeight - 1}>
      <Box marginBottom={1} flexShrink={0}>
        <Text bold color="cyan">Running Droids</Text>
        <Text color="gray"> ({runningDroids.filter(d => d.status === "running").length} active)</Text>
      </Box>

      <Box flexDirection="column" flexGrow={1}>
        {runningDroids.map((droid, index) => {
          const isSelected = index === selectedIndex;
          const statusColor = droid.status === "running" ? "yellow" 
            : droid.status === "complete" ? "green" 
            : "red";
          const statusIcon = droid.status === "running" ? "◐" 
            : droid.status === "complete" ? "✓" 
            : "✗";

          return (
            <Box key={droid.shardId} paddingX={1}>
              <Text color={isSelected ? "cyan" : "white"}>
                {isSelected ? "❯ " : "  "}
              </Text>
              <Text color={statusColor}>{statusIcon} </Text>
              <Text color={isSelected ? "cyan" : "white"} bold={isSelected}>
                {droid.shardTitle}
              </Text>
              <Text color="gray"> ({droid.droid})</Text>
              {droid.status === "running" && (
                <Text color="gray" dimColor> - {formatDuration(droid.startedAt)}</Text>
              )}
            </Box>
          );
        })}
      </Box>

      <Box marginTop={1} flexShrink={0}>
        <Text color="gray">↑↓ Navigate • Enter view output • Esc back</Text>
      </Box>
    </Box>
  );
}

function formatDuration(start: Date, end?: Date): string {
  const now = end || new Date();
  const diffMs = now.getTime() - start.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  
  if (diffSec < 60) {
    return `${diffSec}s`;
  }
  
  const minutes = Math.floor(diffSec / 60);
  const seconds = diffSec % 60;
  
  if (minutes < 60) {
    return `${minutes}m ${seconds}s`;
  }
  
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}h ${mins}m`;
}
