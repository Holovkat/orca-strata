import React, { useState, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import { QuestionPrompt } from "../components/QuestionPrompt.js";
import { Spinner } from "../components/Spinner.js";
import { StatusMessage } from "../components/StatusMessage.js";
import type { OrcaConfig, SprintStatus, Sprint, Phase } from "../lib/types.js";

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
  | "create-shards"
  | "create-board"
  | "create-issues"
  | "create-branch"
  | "complete";

interface SprintData {
  name: string;
  description: string;
  requirements: string[];
  shards: string[];
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
    shards: [],
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requirementIndex, setRequirementIndex] = useState(0);

  useInput((input, key) => {
    if (key.escape) {
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

  const handleRequirementAnswer = useCallback((answer: string) => {
    if (answer.toLowerCase() === "done" || answer.trim() === "") {
      // Move to next phase
      setStep("analyze-patterns");
      runAnalyzePatterns();
    } else {
      setSprintData((prev) => ({
        ...prev,
        requirements: [...prev.requirements, answer],
      }));
      setRequirementIndex((prev) => prev + 1);
    }
  }, []);

  const runAnalyzePatterns = async () => {
    setLoading(true);
    // TODO: Invoke droid to analyze patterns and create shared docs
    await new Promise((resolve) => setTimeout(resolve, 2000)); // Simulated
    setLoading(false);
    setStep("create-shards");
    runCreateShards();
  };

  const runCreateShards = async () => {
    setLoading(true);
    // TODO: Invoke droid to break down requirements into atomic shards
    await new Promise((resolve) => setTimeout(resolve, 2000)); // Simulated
    setSprintData((prev) => ({
      ...prev,
      shards: ["shard-01-api", "shard-02-ui", "shard-03-tests"], // Simulated
    }));
    setLoading(false);
    setStep("create-board");
    runCreateBoard();
  };

  const runCreateBoard = async () => {
    setLoading(true);
    // TODO: Create GitHub project board with standard columns
    await new Promise((resolve) => setTimeout(resolve, 1000)); // Simulated
    setLoading(false);
    setStep("create-issues");
    runCreateIssues();
  };

  const runCreateIssues = async () => {
    setLoading(true);
    // TODO: Create GitHub issues for each shard
    await new Promise((resolve) => setTimeout(resolve, 1500)); // Simulated
    setLoading(false);
    setStep("create-branch");
    runCreateBranch();
  };

  const runCreateBranch = async () => {
    setLoading(true);
    // TODO: Create stacked branch for the sprint
    await new Promise((resolve) => setTimeout(resolve, 500)); // Simulated
    setLoading(false);
    setStep("complete");
  };

  const handleComplete = useCallback(() => {
    const sprint: Sprint = {
      id: `sprint-${Date.now()}`,
      name: sprintData.name,
      branch: `feature/${sprintData.name.toLowerCase().replace(/\s+/g, "-")}-base`,
      phase: "planning" as Phase,
      shards: sprintData.shards.map((s, i) => ({
        id: s,
        title: s,
        file: `${config.paths.features}${sprintData.name}/${s}.md`,
        status: "Ready to Build" as const,
        type: "fullstack" as const,
        dependencies: [],
        creates: [],
      })),
    };

    const status: SprintStatus = {
      sprint,
      counts: {
        total: sprint.shards.length,
        readyToBuild: sprint.shards.length,
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
      const messages: Record<string, string> = {
        "analyze-patterns": "Analyzing requirements for shared patterns...",
        "create-shards": "Breaking down into atomic shards...",
        "create-board": "Creating GitHub project board...",
        "create-issues": "Creating GitHub issues...",
        "create-branch": "Creating branch...",
      };
      return <Spinner message={messages[step] || "Processing..."} />;
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
              <Text>• Shards: {sprintData.shards.length}</Text>
              <Text>• Board: Created</Text>
              <Text>• Issues: Created</Text>
              <Text>• Branch: Created</Text>
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
      </Box>
      {error && (
        <Box marginBottom={1}>
          <StatusMessage type="error" message={error} />
        </Box>
      )}
      {renderStep()}
      <Box marginTop={1}>
        <Text color="gray">Esc to go back</Text>
      </Box>
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
