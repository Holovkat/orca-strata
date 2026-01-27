import React, { useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import { MultilineInput } from "ink-multiline-input";
import { Spinner } from "../components/Spinner.js";
import { StatusMessage } from "../components/StatusMessage.js";
import { Menu } from "../components/Menu.js";
import { readShard, updateShard } from "../lib/shard.js";
import { updateIssueLabels } from "../lib/github.js";
import type { Shard, OrcaConfig, ColumnName } from "../lib/types.js";
import type { ParsedShard } from "../lib/shard.js";
import { join } from "path";

interface ShardEditorProps {
  config: OrcaConfig;
  projectPath: string;
  shard: Shard;
  onBack: () => void;
  onShardUpdated: (shard: Shard) => void;
}

type EditorMode = "view" | "edit-context" | "edit-task" | "edit-criteria" | "menu";

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
  
  // Edit buffers
  const [editContext, setEditContext] = useState("");
  const [editTask, setEditTask] = useState("");
  const [editCriteria, setEditCriteria] = useState("");

  // Load shard content
  useEffect(() => {
    async function loadShard() {
      const shardPath = join(projectPath, shard.file);
      const parsed = await readShard(shardPath);
      if (parsed) {
        setParsedShard(parsed);
        setEditContext(parsed.context);
        setEditTask(parsed.task);
        setEditCriteria(parsed.acceptanceCriteria.map(c => `- [ ] ${c}`).join("\n"));
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
      }
    }
  });

  const handleSave = async (field: "context" | "task" | "criteria", newValue: string) => {
    if (!parsedShard) return;

    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const shardPath = join(projectPath, shard.file);
      
      // Determine if content actually changed
      let contentChanged = false;
      let updatedShard = { ...parsedShard };

      if (field === "context" && newValue !== parsedShard.context) {
        updatedShard.context = newValue;
        contentChanged = true;
      } else if (field === "task" && newValue !== parsedShard.task) {
        updatedShard.task = newValue;
        contentChanged = true;
      } else if (field === "criteria") {
        const newCriteria = newValue
          .split("\n")
          .map(line => line.replace(/^-\s*\[[ x]\]\s*/, "").trim())
          .filter(Boolean);
        if (JSON.stringify(newCriteria) !== JSON.stringify(parsedShard.acceptanceCriteria)) {
          updatedShard.acceptanceCriteria = newCriteria;
          contentChanged = true;
        }
      }

      if (contentChanged) {
        // Reset status if content was modified and status was beyond "Ready to Build"
        let newStatus: ColumnName = shard.status;
        if (shard.status !== "Ready to Build") {
          newStatus = "Ready to Build";
          setSuccess(`Saved changes. Status reset to "Ready to Build" due to content change.`);
        } else {
          setSuccess("Saved changes.");
        }

        // Update the shard file
        await updateShard(shardPath, updatedShard);

        // Update GitHub issue labels if applicable
        if (shard.issueNumber && newStatus !== shard.status) {
          await updateIssueLabels(shard.issueNumber, newStatus);
        }

        // Update local state
        setParsedShard(updatedShard);
        onShardUpdated({
          ...shard,
          status: newStatus,
        });
      } else {
        setSuccess("No changes detected.");
      }

      setMode("view");
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

  // Edit modes
  if (mode === "edit-context") {
    return (
      <Box flexDirection="column">
        <Text bold color="cyan">Edit Context</Text>
        <Text color="gray" dimColor>Ctrl+Enter to save, Esc to cancel</Text>
        <Box marginTop={1} borderStyle="single" borderColor="cyan" paddingX={1}>
          <MultilineInput
            value={editContext}
            onChange={setEditContext}
            onSubmit={(value) => handleSave("context", value)}
            rows={12}
            focus={true}
            showCursor={true}
          />
        </Box>
        {saving && <Spinner message="Saving..." />}
      </Box>
    );
  }

  if (mode === "edit-task") {
    return (
      <Box flexDirection="column">
        <Text bold color="cyan">Edit Task</Text>
        <Text color="gray" dimColor>Ctrl+Enter to save, Esc to cancel</Text>
        <Box marginTop={1} borderStyle="single" borderColor="cyan" paddingX={1}>
          <MultilineInput
            value={editTask}
            onChange={setEditTask}
            onSubmit={(value) => handleSave("task", value)}
            rows={12}
            focus={true}
            showCursor={true}
          />
        </Box>
        {saving && <Spinner message="Saving..." />}
      </Box>
    );
  }

  if (mode === "edit-criteria") {
    return (
      <Box flexDirection="column">
        <Text bold color="cyan">Edit Acceptance Criteria</Text>
        <Text color="gray" dimColor>Format: - [ ] Criterion text (one per line)</Text>
        <Text color="gray" dimColor>Ctrl+Enter to save, Esc to cancel</Text>
        <Box marginTop={1} borderStyle="single" borderColor="cyan" paddingX={1}>
          <MultilineInput
            value={editCriteria}
            onChange={setEditCriteria}
            onSubmit={(value) => handleSave("criteria", value)}
            rows={10}
            focus={true}
            showCursor={true}
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
          { label: "Edit Context", value: "edit-context" },
          { label: "Edit Task", value: "edit-task" },
          { label: "Edit Acceptance Criteria", value: "edit-criteria" },
          { label: "View Raw Content", value: "view-raw" },
          { label: "Back", value: "back" },
        ]}
        onSelect={(value) => {
          if (value === "back") {
            onBack();
          } else if (value === "view-raw") {
            // TODO: Show raw content in a scrollable view
            setSuccess("Raw view not yet implemented");
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
