import React, { useState, useEffect } from "react";
import { Box, Text, useInput, useStdout } from "ink";
import TextInput from "ink-text-input";
import { Spinner } from "../components/Spinner.js";
import { StatusMessage } from "../components/StatusMessage.js";
import { Menu } from "../components/Menu.js";
import { QuestionPrompt } from "../components/QuestionPrompt.js";
import { readShard, updateShard, deprecateShard } from "../lib/shard.js";
import { updateIssueLabels } from "../lib/github.js";
import { invokeDroid } from "../lib/droid.js";
import { scanForSprints } from "../lib/state.js";
import type { Shard, OrcaConfig, ColumnName } from "../lib/types.js";
import type { ParsedShard } from "../lib/shard.js";
import { join } from "path";

interface ShardEditorProps {
  config: OrcaConfig;
  projectPath: string;
  shard: Shard;
  onBack: () => void;
  onShardUpdated: (shard: Shard) => void;
  onShardDeprecated?: (shardId: string) => void;
}

type ViewSection = "context" | "task" | "criteria";
type EditorMode = "view" | "edit" | "menu" | "deprecate-reason" | "deprecate-review" | "model-select";

export function ShardEditor({
  config,
  projectPath,
  shard,
  onBack,
  onShardUpdated,
  onShardDeprecated,
}: ShardEditorProps) {
  const [mode, setMode] = useState<EditorMode>("view");
  const [activeSection, setActiveSection] = useState<ViewSection>("context");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [parsedShard, setParsedShard] = useState<ParsedShard | null>(null);
  
  // Scroll position per section
  const [scrollOffset, setScrollOffset] = useState(0);
  
  // Edit buffer - stores the full content being edited
  const [editBuffer, setEditBuffer] = useState("");
  const [editCursorLine, setEditCursorLine] = useState(0);
  
  // Deprecation state
  const [deprecateReason, setDeprecateReason] = useState("");
  const [deprecateAnalysis, setDeprecateAnalysis] = useState("");
  const [droidOutput, setDroidOutput] = useState("");

  const { stdout } = useStdout();
  const terminalHeight = stdout?.rows || 24;
  const terminalWidth = stdout?.columns || 80;

  // Load shard content
  useEffect(() => {
    async function loadShard() {
      const shardPath = join(projectPath, shard.file);
      const parsed = await readShard(shardPath);
      if (parsed) {
        setParsedShard(parsed);
      } else {
        setError(`Failed to load shard: ${shard.file}`);
      }
      setLoading(false);
    }
    loadShard();
  }, [projectPath, shard.file]);

  // Get content for current section
  const getSectionContent = (): string[] => {
    if (!parsedShard) return [];
    switch (activeSection) {
      case "context":
        return parsedShard.context.split("\n");
      case "task":
        return parsedShard.task.split("\n");
      case "criteria":
        return parsedShard.acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`);
      default:
        return [];
    }
  };

  // Handle input based on mode
  useInput((input, key) => {
    if (mode === "view") {
      if (key.escape) {
        setMode("menu");
      } else if (key.tab) {
        // Cycle through sections
        const sections: ViewSection[] = ["context", "task", "criteria"];
        const idx = sections.indexOf(activeSection);
        setActiveSection(sections[(idx + 1) % sections.length]!);
        setScrollOffset(0);
      } else if (key.upArrow || input === "k") {
        setScrollOffset(prev => Math.max(0, prev - 1));
      } else if (key.downArrow || input === "j") {
        setScrollOffset(prev => prev + 1);
      } else if (key.pageUp) {
        setScrollOffset(prev => Math.max(0, prev - 10));
      } else if (key.pageDown) {
        setScrollOffset(prev => prev + 10);
      } else if (input === "e" || key.return) {
        // Enter edit mode for current section
        const content = getSectionContent();
        if (activeSection === "criteria") {
          // For criteria, join with newlines for editing
          setEditBuffer(parsedShard?.acceptanceCriteria.join("\n") || "");
        } else {
          setEditBuffer(content.join("\n"));
        }
        setEditCursorLine(0);
        setMode("edit");
      }
    } else if (mode === "edit") {
      if (key.escape) {
        setMode("view");
        setEditBuffer("");
      }
      // Note: TextInput handles the actual text editing
    } else if (mode === "menu") {
      if (key.escape) {
        setMode("view");
      }
    }
  });

  // Save edited content
  const handleSaveEdit = async () => {
    if (!parsedShard || !editBuffer.trim()) {
      setMode("view");
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const shardPath = join(projectPath, shard.file);
      let updatedShard = { ...parsedShard };

      if (activeSection === "context") {
        updatedShard.context = editBuffer;
      } else if (activeSection === "task") {
        updatedShard.task = editBuffer;
      } else if (activeSection === "criteria") {
        // Split by newlines, filter empty
        updatedShard.acceptanceCriteria = editBuffer
          .split("\n")
          .map(line => line.replace(/^\d+\.\s*/, "").trim()) // Remove numbering
          .filter(line => line.length > 0);
      }

      let newStatus: ColumnName = shard.status;
      if (shard.status !== "Ready to Build") {
        newStatus = "Ready to Build";
        setSuccess(`Saved. Status reset to "Ready to Build".`);
      } else {
        setSuccess("Saved.");
      }

      await updateShard(shardPath, updatedShard);

      if (shard.issueNumber && newStatus !== shard.status) {
        await updateIssueLabels(shard.issueNumber, newStatus);
      }

      setParsedShard(updatedShard);
      onShardUpdated({ ...shard, status: newStatus });
      setMode("view");
      setEditBuffer("");
    } catch (err) {
      setError(`Failed to save: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  };

  // Analyze deprecation impact
  const analyzeDeprecation = async (reason: string) => {
    setLoading(true);
    setError(null);
    setDroidOutput("");
    
    try {
      const sprints = await scanForSprints(projectPath, config.paths.features);
      const allShards: Shard[] = sprints.flatMap(s => s.shards);
      const dependentShards = allShards.filter(s => 
        s.dependencies.includes(shard.id) && s.id !== shard.id
      );
      
      const prompt = `Analyze the impact of deprecating shard "${shard.title}" (${shard.id}).

Reason: ${reason}
Creates: ${shard.creates.join(", ") || "None"}
Dependent shards: ${dependentShards.map(s => s.id).join(", ") || "None"}

Provide a brief impact summary, affected dependencies, and recommendation.`;

      const result = await invokeDroid(
        { droid: "technical-analyst", prompt, autoLevel: "low", cwd: projectPath },
        config,
        (chunk) => setDroidOutput((prev) => prev + chunk)
      );

      if (result.success) {
        setDeprecateAnalysis(result.output);
        setMode("deprecate-review");
      } else {
        setError("Failed to analyze deprecation impact");
      }
    } catch (err) {
      setError(`Analysis failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
    }
  };

  // Execute deprecation
  const executeDeprecation = async () => {
    setLoading(true);
    try {
      const shardPath = join(projectPath, shard.file);
      await deprecateShard(shardPath, deprecateReason, deprecateAnalysis);
      if (shard.issueNumber) {
        await updateIssueLabels(shard.issueNumber, "Done");
      }
      setSuccess(`Shard ${shard.id} has been deprecated`);
      onShardDeprecated?.(shard.id);
      setTimeout(() => onBack(), 1500);
    } catch (err) {
      setError(`Failed to deprecate: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <Spinner message={`Loading shard: ${shard.title}...`} />;
  }

  if (!parsedShard) {
    return (
      <Box flexDirection="column">
        <StatusMessage type="error" message={error || "Failed to load shard"} />
        <Text color="gray">Press Esc to go back</Text>
      </Box>
    );
  }

  // Calculate layout dimensions
  const headerHeight = 4;
  const footerHeight = 2;
  const contentHeight = Math.max(8, terminalHeight - headerHeight - footerHeight);

  // Deprecation reason mode
  if (mode === "deprecate-reason") {
    return (
      <Box flexDirection="column" height={terminalHeight - 1}>
        <Text bold color="red">⚠️ Deprecate Shard: {shard.title}</Text>
        <Text color="gray" dimColor>This will mark the shard as deprecated.</Text>
        <Box marginTop={1} flexGrow={1}>
          <QuestionPrompt
            question="Why are you deprecating this shard?"
            type="text"
            onAnswer={(answer) => {
              if (answer.trim()) {
                setDeprecateReason(answer);
                analyzeDeprecation(answer);
              } else {
                setMode("menu");
              }
            }}
            onCancel={() => setMode("menu")}
          />
        </Box>
      </Box>
    );
  }

  // Deprecation review mode
  if (mode === "deprecate-review") {
    const analysisLines = deprecateAnalysis.split("\n");
    const visibleLines = analysisLines.slice(0, contentHeight - 4);
    
    return (
      <Box flexDirection="column" height={terminalHeight - 1}>
        <Text bold color="red">Deprecation Impact Analysis</Text>
        <Text color="gray" dimColor>Reason: {deprecateReason}</Text>
        
        <Box marginY={1} flexDirection="column" flexGrow={1} overflow="hidden">
          {visibleLines.map((line, i) => (
            <Text key={i} wrap="truncate-end">{line}</Text>
          ))}
          {analysisLines.length > visibleLines.length && (
            <Text color="gray">... +{analysisLines.length - visibleLines.length} lines</Text>
          )}
        </Box>
        
        {error && <StatusMessage type="error" message={error} />}
        
        <Box flexShrink={0}>
          <Menu
            items={[
              { label: "✓ Confirm Deprecation", value: "confirm" },
              { label: "✗ Cancel", value: "cancel" },
            ]}
            onSelect={(value) => {
              if (value === "confirm") executeDeprecation();
              else { setMode("menu"); setDeprecateReason(""); setDeprecateAnalysis(""); }
            }}
          />
        </Box>
      </Box>
    );
  }

  // Model selection mode
  if (mode === "model-select") {
    const availableModels = [
      { label: "Use Default", value: "", hint: config.droids.model },
      { label: "─────────────", value: "divider", disabled: true },
      { label: "Claude Sonnet 4", value: "claude-sonnet-4-20250514", hint: "Fast, balanced" },
      { label: "Claude Sonnet 4.5", value: "claude-sonnet-4-5-20250929", hint: "Latest, best quality" },
      { label: "Claude Opus 4", value: "claude-opus-4-20250514", hint: "Most capable" },
      { label: "─────────────", value: "divider2", disabled: true },
      { label: "Custom Model...", value: "custom", hint: "Enter model name" },
      { label: "Cancel", value: "cancel" },
    ];
    
    return (
      <Box flexDirection="column" height={terminalHeight - 1}>
        <Text bold color="cyan">Set Model Override for: {shard.title}</Text>
        <Text color="gray" dimColor>Current: {shard.model || `(default: ${config.droids.model})`}</Text>
        
        <Box marginY={1} flexGrow={1}>
          <Menu
            items={availableModels}
            onSelect={(value) => {
              if (value === "cancel") {
                setMode("menu");
              } else if (value === "custom") {
                setEditBuffer(shard.model || "");
                setMode("edit");
                setActiveSection("context"); // Repurpose for model input
              } else if (value === "") {
                // Clear override - use default
                onShardUpdated({ ...shard, model: undefined });
                setSuccess("Model override cleared. Using default.");
                setMode("menu");
              } else if (!value.startsWith("divider")) {
                // Set the selected model
                onShardUpdated({ ...shard, model: value });
                setSuccess(`Model set to: ${value}`);
                setMode("menu");
              }
            }}
          />
        </Box>
      </Box>
    );
  }

  // Menu mode
  if (mode === "menu") {
    const currentModel = shard.model || config.droids.model;
    const isOverridden = !!shard.model;
    
    return (
      <Box flexDirection="column" height={terminalHeight - 1}>
        <Box flexShrink={0} marginBottom={1}>
          <Text bold color="cyan">{parsedShard.metadata.title}</Text>
          <Text color="gray"> ({shard.id})</Text>
        </Box>
        
        <Box flexShrink={0}>
          <Text>Status: </Text>
          <Text color={getStatusColor(shard.status)}>{shard.status}</Text>
          <Text color="gray"> • Type: {shard.type}</Text>
        </Box>
        
        <Box flexShrink={0}>
          <Text>Model: </Text>
          <Text color={isOverridden ? "yellow" : "gray"}>{currentModel}</Text>
          {isOverridden && <Text color="yellow"> (override)</Text>}
        </Box>
        
        {error && <StatusMessage type="error" message={error} />}
        {success && <StatusMessage type="success" message={success} />}
        
        <Box marginY={1} flexGrow={1}>
          <Menu
            title="Actions"
            items={[
              { label: "View/Edit Content", value: "view", hint: "Tab to switch sections, Enter to edit" },
              { label: "Set Model Override", value: "model", hint: isOverridden ? `Current: ${shard.model}` : "Using default" },
              { label: "─────────────", value: "divider", disabled: true },
              { label: "⚠️ Deprecate Shard", value: "deprecate", hint: "Mark as deprecated" },
              { label: "Back", value: "back" },
            ]}
            onSelect={(value) => {
              if (value === "back") onBack();
              else if (value === "view") setMode("view");
              else if (value === "model") setMode("model-select");
              else if (value === "deprecate") setMode("deprecate-reason");
            }}
          />
        </Box>
      </Box>
    );
  }

  // Edit mode - full panel text editing
  if (mode === "edit") {
    const sectionLabel = activeSection === "context" ? "Context" : activeSection === "task" ? "Task" : "Acceptance Criteria";
    
    return (
      <Box flexDirection="column" height={terminalHeight - 1}>
        <Box flexShrink={0} marginBottom={1}>
          <Text bold color="green">Editing: {sectionLabel}</Text>
          <Text color="gray"> (Enter to save, Esc to cancel)</Text>
        </Box>
        
        <Box flexDirection="column" flexGrow={1} borderStyle="single" borderColor="green" padding={1}>
          <TextInput
            value={editBuffer}
            onChange={setEditBuffer}
            onSubmit={handleSaveEdit}
            placeholder={`Enter ${sectionLabel.toLowerCase()}...`}
          />
        </Box>
        
        {saving && <Spinner message="Saving..." />}
        
        <Box flexShrink={0} marginTop={1}>
          <Text color="gray">
            Tip: For multi-line content, use \n for line breaks
          </Text>
        </Box>
      </Box>
    );
  }

  // View mode - default scrollable content view
  const content = getSectionContent();
  const maxScroll = Math.max(0, content.length - contentHeight + 2);
  const safeOffset = Math.min(scrollOffset, maxScroll);
  const visibleLines = content.slice(safeOffset, safeOffset + contentHeight - 2);

  const sectionTabs = [
    { name: "Context", key: "context" as ViewSection, count: parsedShard.context.split("\n").length },
    { name: "Task", key: "task" as ViewSection, count: parsedShard.task.split("\n").length },
    { name: "Criteria", key: "criteria" as ViewSection, count: parsedShard.acceptanceCriteria.length },
  ];

  return (
    <Box flexDirection="column" height={terminalHeight - 1}>
      {/* Header with tabs */}
      <Box flexShrink={0} flexDirection="column">
        <Box marginBottom={1}>
          <Text bold color="cyan">{parsedShard.metadata.title}</Text>
          <Text color="gray"> • {shard.type} • </Text>
          <Text color={getStatusColor(shard.status)}>{shard.status}</Text>
        </Box>
        
        {/* Section tabs */}
        <Box gap={2}>
          {sectionTabs.map((tab) => (
            <Box key={tab.key}>
              <Text 
                color={activeSection === tab.key ? "green" : "gray"}
                bold={activeSection === tab.key}
              >
                {activeSection === tab.key ? "▸ " : "  "}
                {tab.name} ({tab.count})
              </Text>
            </Box>
          ))}
        </Box>
      </Box>
      
      {error && <StatusMessage type="error" message={error} />}
      {success && <StatusMessage type="success" message={success} />}

      {/* Content area */}
      <Box 
        flexDirection="column" 
        flexGrow={1} 
        marginY={1} 
        borderStyle="single" 
        borderColor={activeSection === "context" ? "blue" : activeSection === "task" ? "yellow" : "magenta"}
        paddingX={1}
        overflow="hidden"
      >
        {visibleLines.map((line, i) => (
          <Text key={safeOffset + i} wrap="truncate-end" color="white">
            {line || " "}
          </Text>
        ))}
        {visibleLines.length === 0 && (
          <Text color="gray" dimColor>(empty - press Enter to add content)</Text>
        )}
      </Box>

      {/* Footer */}
      <Box flexShrink={0}>
        <Text color="gray">
          Tab: switch section • ↑↓/jk: scroll • Enter/e: edit • Esc: menu • {safeOffset + 1}-{Math.min(safeOffset + contentHeight - 2, content.length)}/{content.length}
        </Text>
      </Box>
    </Box>
  );
}

function getStatusColor(status: ColumnName): string {
  switch (status) {
    case "Ready to Build": return "white";
    case "In Progress": return "yellow";
    case "Ready for Review": return "blue";
    case "In Review": return "blue";
    case "Ready for UAT": return "magenta";
    case "UAT in Progress": return "magenta";
    case "User Acceptance": return "cyan";
    case "Done": return "green";
    default: return "white";
  }
}
