import React, { useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import { Spinner } from "../components/Spinner.js";
import { StatusMessage } from "../components/StatusMessage.js";
import { Menu } from "../components/Menu.js";
import { readShard, updateShard } from "../lib/shard.js";
import { updateIssueLabels } from "../lib/github.js";
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
}

type EditorMode = "view" | "edit-context" | "edit-task" | "edit-criteria";

export function ShardEditor({
  config,
  projectPath,
  shard,
  onBack,
  onShardUpdated,
}: ShardEditorProps) {
  const [mode, setMode] = useState<EditorMode>("view");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [parsedShard, setParsedShard] = useState<ParsedShard | null>(null);
  
  // Edit buffers (single line for simplicity)
  const [editValue, setEditValue] = useState("");

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

  // Edit modes - simple single line append
  if (mode !== "view") {
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
