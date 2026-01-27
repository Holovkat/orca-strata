import React, { useState, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import { QuestionPrompt } from "../components/QuestionPrompt.js";
import { Spinner } from "../components/Spinner.js";
import { StatusMessage } from "../components/StatusMessage.js";
import { invokeDroid } from "../lib/droid.js";
import { createProject, createIssue, addIssueToProject } from "../lib/github.js";
import { createStackedBranch, getCurrentBranch } from "../lib/git.js";
import { createShard, shardToIssueBody, type ParsedShard } from "../lib/shard.js";
import { buildDependencyGraph } from "../lib/dependencies.js";
import type { OrcaConfig, SprintStatus, Sprint, Phase, Shard } from "../lib/types.js";

interface NewSprintProps {
  config: OrcaConfig;
  projectPath: string;
  onBack: () => void;
  onSprintCreated: (status: SprintStatus) => void;
}

type Step =
  | "name"
  | "description"
  | "gather-requirements"
  | "analyze-patterns"
  | "review-shards"
  | "create-board"
  | "create-issues"
  | "create-branch"
  | "complete";

interface ShardDraft {
  id: string;
  title: string;
  context: string;
  task: string;
  type: "backend" | "frontend" | "fullstack" | "docs";
  requiredReading: Array<{ label: string; path: string }>;
  newInShard: string[];
  acceptanceCriteria: string[];
  creates: string[];
  dependsOn: string[];
  modifies: string[];
}

interface SprintData {
  name: string;
  description: string;
  requirements: string[];
  shardDrafts: ShardDraft[];
  boardNumber?: number;
  issueNumbers: Map<string, number>;
  branch: string;
}

export function NewSprint({
  config,
  projectPath,
  onBack,
  onSprintCreated,
}: NewSprintProps) {
  const [step, setStep] = useState<Step>("name");
  const [sprintData, setSprintData] = useState<SprintData>({
    name: "",
    description: "",
    requirements: [],
    shardDrafts: [],
    issueNumbers: new Map(),
    branch: "",
  });
  const [loading, setLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [requirementIndex, setRequirementIndex] = useState(0);
  const [currentShardIndex, setCurrentShardIndex] = useState(0);
  const [droidOutput, setDroidOutput] = useState<string>("");

  useInput((input, key) => {
    if (key.escape && !loading) {
      onBack();
    }
  });

  const handleNameAnswer = useCallback((answer: string) => {
    setSprintData((prev) => ({ ...prev, name: answer }));
    setStep("description");
  }, []);

  const handleDescriptionAnswer = useCallback((answer: string) => {
    setSprintData((prev) => ({ ...prev, description: answer }));
    setStep("gather-requirements");
  }, []);

  const handleRequirementAnswer = useCallback(
    async (answer: string) => {
      if (answer.toLowerCase() === "done" || answer.trim() === "") {
        if (sprintData.requirements.length === 0) {
          setError("Please enter at least one requirement");
          return;
        }
        setStep("analyze-patterns");
        await runAnalyzePatterns();
      } else {
        setSprintData((prev) => ({
          ...prev,
          requirements: [...prev.requirements, answer],
        }));
        setRequirementIndex((prev) => prev + 1);
      }
    },
    [sprintData.requirements]
  );

  const runAnalyzePatterns = async () => {
    setLoading(true);
    setLoadingMessage("Analyzing requirements and breaking into atomic shards...");
    setError(null);

    try {
      const prompt = `You are analyzing requirements for a sprint named "${sprintData.name}".

## Sprint Goal
${sprintData.description}

## Requirements
${sprintData.requirements.map((r, i) => `${i + 1}. ${r}`).join("\n")}

## Your Task
1. Identify any shared patterns, schemas, or components that should be documented in docs/design/
2. Break these requirements into ATOMIC shards - each shard should be:
   - Small enough for a single droid session
   - Self-contained with clear acceptance criteria
   - Linked to relevant design docs (not duplicating content)

## Output Format
Return a JSON array of shard objects:
\`\`\`json
[
  {
    "id": "shard-01-descriptive-name",
    "title": "Short Title",
    "context": "Why this shard exists",
    "task": "Specific task to complete",
    "type": "backend|frontend|fullstack|docs",
    "requiredReading": [{"label": "Doc Name", "path": "../../docs/design/file.md"}],
    "newInShard": ["New thing 1", "New thing 2"],
    "acceptanceCriteria": ["Criterion 1", "Criterion 2"],
    "creates": ["path/to/new/file.ts"],
    "dependsOn": ["shard-id-if-depends"],
    "modifies": ["path/to/existing/file.ts"]
  }
]
\`\`\`

Return ONLY the JSON array, no other text.`;

      const result = await invokeDroid(
        {
          droid: "technical-analyst",
          prompt,
          autoLevel: "low",
        },
        config,
        (chunk) => setDroidOutput((prev) => prev + chunk)
      );

      if (!result.success) {
        throw new Error("Failed to analyze requirements");
      }

      // Parse the JSON from the output
      const jsonMatch = result.output.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        throw new Error("Could not parse shard breakdown from AI response");
      }

      const shardDrafts: ShardDraft[] = JSON.parse(jsonMatch[0]);

      setSprintData((prev) => ({ ...prev, shardDrafts }));
      setLoading(false);
      setDroidOutput("");
      setStep("review-shards");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Analysis failed");
      setLoading(false);
      setDroidOutput("");
    }
  };

  const handleShardApproval = useCallback(
    async (approved: string) => {
      if (approved === "yes") {
        // Move to next shard or next step
        if (currentShardIndex < sprintData.shardDrafts.length - 1) {
          setCurrentShardIndex((prev) => prev + 1);
        } else {
          // All shards reviewed, proceed to create board
          setStep("create-board");
          await runCreateBoard();
        }
      } else {
        // User wants to modify - for now just skip
        // TODO: Add edit capability
        if (currentShardIndex < sprintData.shardDrafts.length - 1) {
          setCurrentShardIndex((prev) => prev + 1);
        } else {
          setStep("create-board");
          await runCreateBoard();
        }
      }
    },
    [currentShardIndex, sprintData.shardDrafts.length]
  );

  const runCreateBoard = async () => {
    setLoading(true);
    setLoadingMessage("Creating GitHub project board...");
    setError(null);

    try {
      const boardName = `Sprint: ${sprintData.name}`;
      const project = await createProject(boardName);

      if (project) {
        setSprintData((prev) => ({ ...prev, boardNumber: project.number }));
      }

      setLoading(false);
      setStep("create-issues");
      await runCreateIssues();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create board");
      setLoading(false);
    }
  };

  const runCreateIssues = async () => {
    setLoading(true);
    setError(null);

    const issueNumbers = new Map<string, number>();

    for (let i = 0; i < sprintData.shardDrafts.length; i++) {
      const shard = sprintData.shardDrafts[i]!;
      setLoadingMessage(`Creating issue ${i + 1}/${sprintData.shardDrafts.length}: ${shard.title}`);

      try {
        // Create shard file first
        const shardPath = await createShard(
          `${projectPath}/${config.paths.features}`,
          sprintData.name.toLowerCase().replace(/\s+/g, "-"),
          shard.id,
          {
            title: shard.title,
            context: shard.context,
            task: shard.task,
            requiredReading: shard.requiredReading,
            newInShard: shard.newInShard,
            acceptanceCriteria: shard.acceptanceCriteria,
            creates: shard.creates,
            dependsOn: shard.dependsOn,
            modifies: shard.modifies,
          }
        );

        // Create GitHub issue
        const issueBody = `## Shard: ${shard.title}

### Context
${shard.context}

### Task
${shard.task}

### Acceptance Criteria
${shard.acceptanceCriteria.map((c) => `- [ ] ${c}`).join("\n")}

### Dependencies
- **Creates:** ${shard.creates.join(", ") || "N/A"}
- **Depends on:** ${shard.dependsOn.join(", ") || "None"}
- **Modifies:** ${shard.modifies.join(", ") || "None"}

### Shard File
\`${shardPath}\`

---
*Type: ${shard.type}*
`;

        const issue = await createIssue(
          `[${sprintData.name}] ${shard.title}`,
          issueBody,
          ["sprint", shard.type]
        );

        if (issue) {
          issueNumbers.set(shard.id, issue.number);

          // Add to project board if we have one
          if (sprintData.boardNumber) {
            await addIssueToProject(sprintData.boardNumber, issue.number);
          }
        }
      } catch (err) {
        console.error(`Failed to create issue for ${shard.id}:`, err);
      }
    }

    setSprintData((prev) => ({ ...prev, issueNumbers }));
    setLoading(false);
    setStep("create-branch");
    await runCreateBranch();
  };

  const runCreateBranch = async () => {
    setLoading(true);
    setLoadingMessage("Creating sprint branch...");
    setError(null);

    try {
      const branchName = `feature/${sprintData.name.toLowerCase().replace(/\s+/g, "-")}-base`;

      const success = await createStackedBranch(branchName, projectPath);

      if (!success) {
        // Branch might already exist, try to get current
        const current = await getCurrentBranch(projectPath);
        setSprintData((prev) => ({ ...prev, branch: current || branchName }));
      } else {
        setSprintData((prev) => ({ ...prev, branch: branchName }));
      }

      setLoading(false);
      setStep("complete");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create branch");
      setLoading(false);
    }
  };

  const handleComplete = useCallback(() => {
    const shards: Shard[] = sprintData.shardDrafts.map((draft) => ({
      id: draft.id,
      title: draft.title,
      file: `${config.paths.features}${sprintData.name.toLowerCase().replace(/\s+/g, "-")}/${draft.id}.md`,
      issueNumber: sprintData.issueNumbers.get(draft.id),
      status: "Ready to Build" as const,
      type: draft.type,
      dependencies: draft.dependsOn,
      creates: draft.creates,
    }));

    // Build dependency graph to determine parallel groups
    const depGraph = buildDependencyGraph(shards);

    const sprint: Sprint = {
      id: `sprint-${Date.now()}`,
      name: sprintData.name,
      board: sprintData.boardNumber?.toString(),
      branch: sprintData.branch,
      phase: "build" as Phase,
      shards,
    };

    const status: SprintStatus = {
      sprint,
      counts: {
        total: shards.length,
        readyToBuild: shards.length,
        inProgress: 0,
        readyForReview: 0,
        inReview: 0,
        readyForUat: 0,
        uatInProgress: 0,
        userAcceptance: 0,
        done: 0,
      },
      activeDroids: [],
    };

    onSprintCreated(status);
  }, [sprintData, config, onSprintCreated]);

  const renderStep = () => {
    if (loading) {
      return (
        <Box flexDirection="column">
          <Spinner message={loadingMessage} />
          {droidOutput && (
            <Box marginTop={1} flexDirection="column">
              <Text color="gray">AI Output:</Text>
              <Text color="gray">
                {droidOutput.slice(-500)}
              </Text>
            </Box>
          )}
        </Box>
      );
    }

    switch (step) {
      case "name":
        return (
          <QuestionPrompt
            question="What is the name of this sprint?"
            type="text"
            onAnswer={handleNameAnswer}
            onCancel={onBack}
          />
        );

      case "description":
        return (
          <QuestionPrompt
            question="Briefly describe the goal of this sprint:"
            type="text"
            onAnswer={handleDescriptionAnswer}
            onCancel={onBack}
          />
        );

      case "gather-requirements":
        return (
          <Box flexDirection="column">
            {sprintData.requirements.length > 0 && (
              <Box flexDirection="column" marginBottom={1}>
                <Text bold color="green">
                  Requirements gathered:
                </Text>
                {sprintData.requirements.map((req, i) => (
                  <Text key={i} color="gray">
                    {i + 1}. {req}
                  </Text>
                ))}
              </Box>
            )}
            <QuestionPrompt
              question={`Requirement ${requirementIndex + 1} (or type 'done' to finish):`}
              type="text"
              onAnswer={handleRequirementAnswer}
              onCancel={onBack}
            />
          </Box>
        );

      case "review-shards":
        const currentShard = sprintData.shardDrafts[currentShardIndex];
        if (!currentShard) return null;

        return (
          <Box flexDirection="column">
            <Box marginBottom={1}>
              <Text bold color="cyan">
                Shard {currentShardIndex + 1}/{sprintData.shardDrafts.length}
              </Text>
            </Box>
            <Box flexDirection="column" marginBottom={1} paddingX={1}>
              <Text bold>{currentShard.title}</Text>
              <Text color="gray">Type: {currentShard.type}</Text>
              <Text color="gray">ID: {currentShard.id}</Text>
              <Box marginTop={1}>
                <Text>Task: {currentShard.task}</Text>
              </Box>
              <Box marginTop={1} flexDirection="column">
                <Text bold>Acceptance Criteria:</Text>
                {currentShard.acceptanceCriteria.map((c, i) => (
                  <Text key={i} color="gray">
                    • {c}
                  </Text>
                ))}
              </Box>
              {currentShard.dependsOn.length > 0 && (
                <Box marginTop={1}>
                  <Text color="yellow">
                    Depends on: {currentShard.dependsOn.join(", ")}
                  </Text>
                </Box>
              )}
            </Box>
            <QuestionPrompt
              question="Approve this shard?"
              type="confirm"
              onAnswer={handleShardApproval}
              onCancel={onBack}
            />
          </Box>
        );

      case "complete":
        return (
          <Box flexDirection="column" gap={1}>
            <StatusMessage
              type="success"
              message="Sprint created successfully!"
            />
            <Box flexDirection="column" marginY={1}>
              <Text bold>Summary:</Text>
              <Text>• Name: {sprintData.name}</Text>
              <Text>• Shards: {sprintData.shardDrafts.length}</Text>
              <Text>• Board: {sprintData.boardNumber ? `#${sprintData.boardNumber}` : "N/A"}</Text>
              <Text>• Issues: {sprintData.issueNumbers.size} created</Text>
              <Text>• Branch: {sprintData.branch}</Text>
            </Box>
            <Box marginTop={1} flexDirection="column">
              <Text bold>Shards created:</Text>
              {sprintData.shardDrafts.map((shard) => (
                <Text key={shard.id} color="gray">
                  • {shard.title} (#{sprintData.issueNumbers.get(shard.id) || "?"})
                </Text>
              ))}
            </Box>
            <Box marginTop={1}>
              <Text color="cyan">Press Enter to continue to Build phase...</Text>
            </Box>
            <PressEnter onPress={handleComplete} />
          </Box>
        );

      default:
        return null;
    }
  };

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold color="white">
          New Sprint
        </Text>
        <Text color="gray"> - Planning Phase</Text>
        {step !== "name" && step !== "description" && (
          <Text color="gray"> - {sprintData.name}</Text>
        )}
      </Box>
      {error && (
        <Box marginBottom={1}>
          <StatusMessage type="error" message={error} />
        </Box>
      )}
      {renderStep()}
      {!loading && (
        <Box marginTop={1}>
          <Text color="gray">Esc to go back</Text>
        </Box>
      )}
    </Box>
  );
}

function PressEnter({ onPress }: { onPress: () => void }) {
  useInput((input, key) => {
    if (key.return) {
      onPress();
    }
  });
  return null;
}
