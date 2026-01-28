import React, { useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";
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
import { spawn } from "child_process";

interface ShardEditorProps {
  config: OrcaConfig;
  projectPath: string;
  shard: Shard;
  onBack: () => void;
  onShardUpdated: (shard: Shard) => void;
  onShardDeprecated?: (shardId: string) => void;
}

type EditorMode = "view" | "edit-context" | "edit-task" | "edit-criteria" | "deprecate-reason" | "deprecate-review";

export function ShardEditor({
  config,
  projectPath,
  shard,
  onBack,
  onShardUpdated,
  onShardDeprecated,
}: ShardEditorProps) {
  const [mode, setMode] = useState<EditorMode>("view");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [parsedShard, setParsedShard] = useState<ParsedShard | null>(null);
  
  // Edit buffers (single line for simplicity)
  const [editValue, setEditValue] = useState("");
  
  // Deprecation state
  const [deprecateReason, setDeprecateReason] = useState("");
  const [deprecateAnalysis, setDeprecateAnalysis] = useState("");
  const [droidOutput, setDroidOutput] = useState("");

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

  useInput((input, key) => {
    if (key.escape) {
      if (mode === "view") {
        onBack();
      } else {
        setMode("view");
        setEditValue("");
      }
    }
  });

  const openInEditor = () => {
    const shardPath = join(projectPath, shard.file);
    const editor = process.env.EDITOR || "vi";
    
    // Open in external editor
    const proc = spawn(editor, [shardPath], {
      stdio: "inherit",
    });
    
    proc.on("close", async () => {
      // Reload the shard after editing
      setLoading(true);
      const parsed = await readShard(shardPath);
      if (parsed) {
        setParsedShard(parsed);
        
        // Check if status should be reset
        if (shard.status !== "Ready to Build") {
          const newStatus: ColumnName = "Ready to Build";
          if (shard.issueNumber) {
            await updateIssueLabels(shard.issueNumber, newStatus);
          }
          onShardUpdated({ ...shard, status: newStatus });
          setSuccess("File edited. Status reset to 'Ready to Build'.");
        } else {
          setSuccess("File reloaded.");
        }
      }
      setLoading(false);
    });
  };

  const handleSave = async (field: "context" | "task" | "criteria") => {
    if (!parsedShard || !editValue.trim()) return;

    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const shardPath = join(projectPath, shard.file);
      let updatedShard = { ...parsedShard };
      let contentChanged = false;

      if (field === "context") {
        // Append to existing context
        updatedShard.context = parsedShard.context + "\n\n" + editValue;
        contentChanged = true;
      } else if (field === "task") {
        // Append to existing task
        updatedShard.task = parsedShard.task + "\n\n" + editValue;
        contentChanged = true;
      } else if (field === "criteria") {
        // Add new criterion
        updatedShard.acceptanceCriteria = [...parsedShard.acceptanceCriteria, editValue];
        contentChanged = true;
      }

      if (contentChanged) {
        let newStatus: ColumnName = shard.status;
        if (shard.status !== "Ready to Build") {
          newStatus = "Ready to Build";
          setSuccess(`Added content. Status reset to "Ready to Build".`);
        } else {
          setSuccess("Added content.");
        }

        await updateShard(shardPath, updatedShard);

        if (shard.issueNumber && newStatus !== shard.status) {
          await updateIssueLabels(shard.issueNumber, newStatus);
        }

        setParsedShard(updatedShard);
        onShardUpdated({ ...shard, status: newStatus });
      }

      setMode("view");
      setEditValue("");
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
      // Load all sprints to find dependencies
      const sprints = await scanForSprints(projectPath, config.paths.features);
      const allShards: Shard[] = sprints.flatMap(s => s.shards);
      
      // Find shards that depend on this one
      const dependentShards = allShards.filter(s => 
        s.dependencies.includes(shard.id) && s.id !== shard.id
      );
      
      const prompt = `You are analyzing the impact of deprecating a shard in a sprint.

## Shard Being Deprecated
ID: ${shard.id}
Title: ${shard.title}
Creates: ${shard.creates.join(", ") || "None"}
Type: ${shard.type}

## Reason for Deprecation
${reason}

## Shards That Depend on This One
${dependentShards.length > 0 
  ? dependentShards.map(s => `- ${s.id}: ${s.title} (depends on: ${s.dependencies.join(", ")})`).join("\n")
  : "None"}

## All Shards in Sprint
${allShards.map(s => `- ${s.id}: ${s.title} [${s.type}] creates: ${s.creates.join(", ") || "none"}`).join("\n")}

## Your Task
Analyze the impact of deprecating this shard and provide:

1. **Impact Summary**: What will be affected by removing this shard?
2. **Dependency Adjustments**: Which shards need their dependencies updated?
3. **Orphaned Work**: Are there any files/features that will no longer be created?
4. **Recommendations**: Should the work be reassigned to another shard, or is it safe to remove?

Provide a concise analysis (not a JSON response).`;

      const result = await invokeDroid(
        {
          droid: "technical-analyst",
          prompt,
          autoLevel: "low",
          cwd: projectPath,
        },
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
    setError(null);
    
    try {
      const shardPath = join(projectPath, shard.file);
      await deprecateShard(shardPath, deprecateReason, deprecateAnalysis);
      
      // Close issue if exists
      if (shard.issueNumber) {
        await updateIssueLabels(shard.issueNumber, "Done");
      }
      
      setSuccess(`Shard ${shard.id} has been deprecated`);
      onShardDeprecated?.(shard.id);
      
      // Go back after a brief delay
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

  // Deprecation reason mode
  if (mode === "deprecate-reason") {
    return (
      <Box flexDirection="column">
        <Text bold color="red">Deprecate Shard: {shard.title}</Text>
        <Text color="gray" dimColor>This will mark the shard as deprecated and analyze impact on other shards.</Text>
        <Box marginTop={1}>
          <QuestionPrompt
            question="Why are you deprecating this shard? (e.g., 'feature no longer needed', 'merged with shard-05', 'scope changed')"
            type="text"
            onAnswer={(answer) => {
              if (answer.trim()) {
                setDeprecateReason(answer);
                analyzeDeprecation(answer);
              } else {
                setMode("view");
              }
            }}
            onCancel={() => setMode("view")}
          />
        </Box>
        {droidOutput && (
          <Box marginTop={1} flexDirection="column">
            <Text color="yellow">Analyzing...</Text>
            <Text color="gray">{droidOutput.slice(-200)}</Text>
          </Box>
        )}
      </Box>
    );
  }

  // Deprecation review mode
  if (mode === "deprecate-review") {
    return (
      <Box flexDirection="column">
        <Text bold color="red">Deprecation Impact Analysis</Text>
        <Text color="gray" dimColor>Reason: {deprecateReason}</Text>
        
        <Box marginTop={1} flexDirection="column" borderStyle="single" borderColor="yellow" paddingX={1}>
          <Text>{deprecateAnalysis.slice(0, 800)}</Text>
          {deprecateAnalysis.length > 800 && <Text color="gray">... (truncated)</Text>}
        </Box>
        
        {error && <StatusMessage type="error" message={error} />}
        {success && <StatusMessage type="success" message={success} />}
        
        <Box marginTop={1}>
          <Menu
            items={[
              { label: "✓ Confirm Deprecation", value: "confirm", hint: "Mark shard as deprecated" },
              { label: "✗ Cancel", value: "cancel", hint: "Keep shard active" },
            ]}
            onSelect={(value) => {
              if (value === "confirm") {
                executeDeprecation();
              } else {
                setMode("view");
                setDeprecateReason("");
                setDeprecateAnalysis("");
              }
            }}
            onCancel={() => {
              setMode("view");
              setDeprecateReason("");
              setDeprecateAnalysis("");
            }}
          />
        </Box>
      </Box>
    );
  }

  // Edit modes - simple single line append
  if (mode.startsWith("edit-")) {
    const fieldName = mode === "edit-context" ? "context" : mode === "edit-task" ? "task" : "criterion";
    const field = mode === "edit-context" ? "context" : mode === "edit-task" ? "task" : "criteria";
    
    return (
      <Box flexDirection="column">
        <Text bold color="cyan">Add to {fieldName}</Text>
        <Text color="gray" dimColor>Enter to save, Esc to cancel</Text>
        <Box marginTop={1}>
          <Text color="cyan">❯ </Text>
          <TextInput
            value={editValue}
            onChange={setEditValue}
            onSubmit={() => handleSave(field)}
            placeholder={`Add new ${fieldName}...`}
          />
        </Box>
        {saving && <Spinner message="Saving..." />}
      </Box>
    );
  }

  // View mode
  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold color="cyan">{parsedShard.metadata.title}</Text>
        <Text color="gray"> ({shard.id})</Text>
      </Box>

      {/* Status */}
      <Box marginBottom={1}>
        <Text>Status: </Text>
        <Text color={getStatusColor(shard.status)}>{shard.status}</Text>
        {shard.issueNumber && (
          <Text color="gray"> • Issue #{shard.issueNumber}</Text>
        )}
      </Box>

      {/* Type and Dependencies */}
      <Box marginBottom={1}>
        <Text color="gray">Type: {shard.type}</Text>
        {shard.dependencies.length > 0 && (
          <Text color="gray"> • Depends: {shard.dependencies.join(", ")}</Text>
        )}
      </Box>

      {error && <StatusMessage type="error" message={error} />}
      {success && <StatusMessage type="success" message={success} />}

      {/* Context Preview */}
      <Box flexDirection="column" marginBottom={1}>
        <Text bold underline>Context</Text>
        <Text color="white">{truncate(parsedShard.context, 200)}</Text>
      </Box>

      {/* Task Preview */}
      <Box flexDirection="column" marginBottom={1}>
        <Text bold underline>Task</Text>
        <Text color="white">{truncate(parsedShard.task, 200)}</Text>
      </Box>

      {/* Acceptance Criteria */}
      <Box flexDirection="column" marginBottom={1}>
        <Text bold underline>Acceptance Criteria ({parsedShard.acceptanceCriteria.length})</Text>
        {parsedShard.acceptanceCriteria.slice(0, 5).map((criterion, i) => (
          <Text key={i} color="white">• {truncate(criterion, 60)}</Text>
        ))}
        {parsedShard.acceptanceCriteria.length > 5 && (
          <Text color="gray">... and {parsedShard.acceptanceCriteria.length - 5} more</Text>
        )}
      </Box>

      {/* Actions Menu */}
      <Menu
        title="Actions"
        items={[
          { label: "Open in Editor ($EDITOR)", value: "open-editor", hint: process.env.EDITOR || "vi" },
          { label: "Add to Context", value: "edit-context" },
          { label: "Add to Task", value: "edit-task" },
          { label: "Add Acceptance Criterion", value: "edit-criteria" },
          { label: "─────────────", value: "divider", disabled: true },
          { label: "⚠️ Deprecate Shard", value: "deprecate-reason", hint: "Mark as deprecated with impact analysis" },
          { label: "Back", value: "back" },
        ]}
        onSelect={(value) => {
          if (value === "back") {
            onBack();
          } else if (value === "open-editor") {
            openInEditor();
          } else {
            setMode(value as EditorMode);
          }
        }}
      />
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

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + "...";
}
