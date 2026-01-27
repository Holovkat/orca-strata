import React, { useState, useCallback, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import { join } from "path";
import { QuestionPrompt } from "../components/QuestionPrompt.js";
import { Menu, type MenuItem } from "../components/Menu.js";
import { Spinner } from "../components/Spinner.js";
import { StatusMessage } from "../components/StatusMessage.js";
import { PrdQA, type PrdAnswers } from "../components/PrdQA.js";
import { invokeDroid } from "../lib/droid.js";
import { createProject, createIssue, addIssueToProject } from "../lib/github.js";
import { createStackedBranch, getCurrentBranch } from "../lib/git.js";
import { createShard, shardToIssueBody, type ParsedShard } from "../lib/shard.js";
import { buildDependencyGraph } from "../lib/dependencies.js";
import { scaffoldProject, hasPrd, updatePrdFromAnswers } from "../lib/scaffold.js";
import type { OrcaConfig, SprintStatus, Sprint, Phase, Shard } from "../lib/types.js";

interface NewSprintProps {
  config: OrcaConfig;
  projectPath: string;
  onBack: () => void;
  onSprintCreated: (status: SprintStatus) => void;
  onProjectPathChange?: (newPath: string) => void;
}

type Step =
  | "select-project"
  | "create-project"
  | "prd-qa"
  | "sprint-type"        // New: choose initial/bug/feature/enhancement
  | "name"
  | "description"
  | "gather-requirements" // Only for bug/feature/enhancement
  | "analyze-patterns"
  | "review-shards"
  | "create-board"
  | "create-issues"
  | "create-branch"
  | "complete";

type SprintType = "initial" | "feature" | "enhancement" | "bugfix";

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
  sprintType: SprintType;
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
  onProjectPathChange,
}: NewSprintProps) {
  const [step, setStep] = useState<Step>("select-project");
  const [sprintData, setSprintData] = useState<SprintData>({
    name: "",
    description: "",
    sprintType: "initial",
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
  const [existingProjects, setExistingProjects] = useState<string[]>([]);
  const [selectedProjectPath, setSelectedProjectPath] = useState<string>(projectPath);
  const [newProjectName, setNewProjectName] = useState<string>("");
  const [projectHasPrd, setProjectHasPrd] = useState<boolean>(false);
  const [prdAnswers, setPrdAnswers] = useState<PrdAnswers | null>(null);

  // Load existing projects from workspace
  useEffect(() => {
    const loadProjects = async () => {
      const projectsDir = config.workspace_root 
        ? join(config.workspace_root, "projects")
        : join(projectPath, "projects");
      
      try {
        const { readdir, stat } = await import("fs/promises");
        const entries = await readdir(projectsDir);
        const dirs: string[] = [];
        
        for (const entry of entries) {
          const fullPath = join(projectsDir, entry);
          const stats = await stat(fullPath).catch(() => null);
          if (stats?.isDirectory() && !entry.startsWith(".")) {
            dirs.push(entry);
          }
        }
        
        setExistingProjects(dirs);
      } catch {
        // projects folder doesn't exist yet
        setExistingProjects([]);
      }
    };
    
    loadProjects();
  }, [config.workspace_root, projectPath]);

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

  // Analyze PRD directly for initial implementation sprint
  const runAnalyzePrd = async () => {
    setLoading(true);
    setLoadingMessage("Analyzing PRD and generating implementation plan...");
    setError(null);

    try {
      // Read the PRD file
      const { readFile } = await import("fs/promises");
      const prdPath = join(selectedProjectPath, "features", "prd.md");
      const prdContent = await readFile(prdPath, "utf-8");

      const prompt = `You are analyzing a Product Requirements Document (PRD) to create an implementation plan.

## PRD Content
${prdContent}

## Your Task
Create a comprehensive implementation plan broken into atomic shards.

1. FIRST create "shard-00-architecture" - this MUST be the first shard and sets up:
   - Project structure and folder organization  
   - Tech stack and dependencies
   - Shared interfaces/types based on PRD domain
   - Design documents outlining architecture decisions
   - Any scaffolding needed before implementation
   
2. Then create implementation shards based on PRD features:
   - Break each core feature into 1-3 atomic shards
   - Prioritize MVP features first
   - Each shard should be completable in a single droid session
   - ALL shards MUST depend on shard-00-architecture

## Output Format
Return a JSON array of shard objects:
\`\`\`json
[
  {
    "id": "shard-00-architecture",
    "title": "Project Architecture and Setup",
    "context": "Establishes project foundation based on PRD requirements",
    "task": "Set up project structure, tech stack, interfaces, and design docs",
    "type": "docs",
    "requiredReading": [{"label": "PRD", "path": "../../features/prd.md"}],
    "newInShard": ["Project structure", "Tech stack setup", "Domain interfaces", "Architecture docs"],
    "acceptanceCriteria": ["Project compiles", "All domain types defined", "Design docs complete"],
    "creates": ["docs/design/architecture.md", "src/types/index.ts"],
    "dependsOn": [],
    "modifies": ["package.json"]
  },
  {
    "id": "shard-01-feature-name",
    "title": "Implement Feature X",
    "context": "From PRD: [relevant section]",
    "task": "Specific implementation task",
    "type": "backend|frontend|fullstack",
    "requiredReading": [{"label": "Architecture", "path": "../../docs/design/architecture.md"}],
    "newInShard": ["Component A", "Service B"],
    "acceptanceCriteria": ["Feature works", "Tests pass"],
    "creates": ["src/components/X.tsx"],
    "dependsOn": ["shard-00-architecture"],
    "modifies": []
  }
]
\`\`\`

Return ONLY the JSON array, no other text.`;

      const result = await invokeDroid(
        {
          droid: "technical-analyst",
          prompt,
          autoLevel: "low",
          cwd: selectedProjectPath,
        },
        config,
        (chunk) => setDroidOutput((prev) => prev + chunk)
      );

      if (!result.success) {
        throw new Error("Failed to analyze PRD");
      }

      // Parse the JSON response
      const jsonMatch = result.output.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        throw new Error("Failed to parse shard definitions from AI response");
      }

      const shards = JSON.parse(jsonMatch[0]) as ShardDraft[];
      
      // Validate architecture shard exists
      if (!shards.some(s => s.id === "shard-00-architecture")) {
        throw new Error("AI response missing required shard-00-architecture");
      }

      setSprintData((prev) => ({ ...prev, shardDrafts: shards }));
      setLoading(false);
      setStep("review-shards");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to analyze PRD");
      setLoading(false);
    }
  };

  // Analyze user-provided requirements for bug/feature/enhancement sprints
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
1. FIRST create "shard-00-architecture" - this MUST be the first shard and sets up:
   - Project structure and folder organization
   - Dependencies (package.json, etc.)
   - Shared interfaces/types
   - Design documents in docs/design/
   - Any scaffolding needed before implementation
   
2. Then break remaining requirements into ATOMIC implementation shards:
   - Small enough for a single droid session
   - Self-contained with clear acceptance criteria
   - ALL implementation shards MUST depend on shard-00-architecture
   - Link to design docs created by architecture shard

## IMPORTANT
- shard-00-architecture is MANDATORY and must come first
- All other shards must have "shard-00-architecture" in their dependsOn array
- Shards should be numbered sequentially: shard-00, shard-01, shard-02, etc.

## Output Format
Return a JSON array of shard objects:
\`\`\`json
[
  {
    "id": "shard-00-architecture",
    "title": "Project Architecture and Setup",
    "context": "Establishes project foundation before implementation",
    "task": "Set up project structure, dependencies, interfaces, and design docs",
    "type": "docs",
    "requiredReading": [],
    "newInShard": ["Project structure", "Shared interfaces", "Design documents"],
    "acceptanceCriteria": ["Project compiles", "All interfaces defined", "Design docs complete"],
    "creates": ["docs/design/architecture.md", "src/types/index.ts"],
    "dependsOn": [],
    "modifies": ["package.json"]
  },
  {
    "id": "shard-01-descriptive-name",
    "title": "Short Title",
    "context": "Why this shard exists",
    "task": "Specific task to complete",
    "type": "backend|frontend|fullstack|docs",
    "requiredReading": [{"label": "Architecture", "path": "../../docs/design/architecture.md"}],
    "newInShard": ["New thing 1", "New thing 2"],
    "acceptanceCriteria": ["Criterion 1", "Criterion 2"],
    "creates": ["path/to/new/file.ts"],
    "dependsOn": ["shard-00-architecture"],
    "modifies": []
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

    // Calculate projects directory
    const projectsDir = config.workspace_root 
      ? join(config.workspace_root, "projects")
      : join(projectPath, "projects");

    switch (step) {
      case "select-project":
        
        const projectMenuItems: MenuItem[] = [
          ...existingProjects.map(p => ({
            label: p,
            value: `existing:${p}`,
            hint: "existing project",
          })),
          {
            label: "+ Create New Project",
            value: "new",
            hint: "start fresh",
          },
          {
            label: "Use Current Directory",
            value: "current",
            hint: projectPath,
          },
          {
            label: "Back",
            value: "back",
          },
        ];

        const handleProjectSelect = async (value: string) => {
          if (value === "back") {
            onBack();
          } else if (value === "current") {
            setSelectedProjectPath(projectPath);
            // Check if current project has PRD
            const hasPrdResult = await hasPrd(projectPath);
            setProjectHasPrd(hasPrdResult);
            // Has PRD -> sprint type selection, no PRD -> PRD Q&A first
            setStep(hasPrdResult ? "sprint-type" : "prd-qa");
          } else if (value === "new") {
            // Show prompt for new project name
            setNewProjectName("");
            setStep("create-project");
          } else if (value.startsWith("existing:")) {
            const projectName = value.replace("existing:", "");
            const newPath = join(projectsDir, projectName);
            setSelectedProjectPath(newPath);
            onProjectPathChange?.(newPath);
            // Check if project has PRD
            const hasPrdResult = await hasPrd(newPath);
            setProjectHasPrd(hasPrdResult);
            // Has PRD -> sprint type selection, no PRD -> PRD Q&A first
            setStep(hasPrdResult ? "sprint-type" : "prd-qa");
          }
        };

        return (
          <Box flexDirection="column">
            <Text bold color="cyan">Select Project</Text>
            <Text color="gray" dimColor>Projects folder: {projectsDir}</Text>
            {existingProjects.length === 0 && (
              <Text color="yellow" dimColor>No existing projects found</Text>
            )}
            <Box marginTop={1}>
              <Menu items={projectMenuItems} onSelect={handleProjectSelect} />
            </Box>
          </Box>
        );

      case "create-project":
        return (
          <Box flexDirection="column">
            <Text bold color="cyan">Create New Project</Text>
            <Text color="gray" dimColor>This will create a new folder in: {projectsDir}</Text>
            <Box marginTop={1}>
              <QuestionPrompt
                question="Enter new project name (folder name):"
                type="text"
                onAnswer={async (answer) => {
                  if (!answer.trim()) {
                    setError("Project name cannot be empty");
                    return;
                  }
                  const safeName = answer.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
                  const newPath = join(projectsDir, safeName);
                  
                  setLoading(true);
                  setLoadingMessage(`Creating project: ${safeName}`);
                  
                  const result = await scaffoldProject(newPath, safeName);
                  
                  if (!result.success) {
                    setError(result.error || "Failed to create project");
                    setLoading(false);
                    return;
                  }
                  
                  setSelectedProjectPath(newPath);
                  onProjectPathChange?.(newPath);
                  setNewProjectName(safeName);
                  setLoading(false);
                  // New projects always need PRD Q&A
                  setStep("prd-qa");
                }}
                onCancel={() => setStep("select-project")}
              />
            </Box>
          </Box>
        );

      case "prd-qa":
        return (
          <PrdQA
            projectName={newProjectName || selectedProjectPath.split("/").pop() || "Project"}
            projectPath={selectedProjectPath}
            initialAnswers={prdAnswers || undefined}
            onComplete={async (answers) => {
              setPrdAnswers(answers);
              setLoading(true);
              setLoadingMessage("Saving PRD...");
              
              try {
                await updatePrdFromAnswers(selectedProjectPath, answers);
                setProjectHasPrd(true);
                setLoading(false);
                // After PRD, go to sprint type selection
                setStep("sprint-type");
              } catch (err) {
                setError(err instanceof Error ? err.message : "Failed to save PRD");
                setLoading(false);
              }
            }}
            onCancel={() => setStep("select-project")}
          />
        );

      case "sprint-type":
        const sprintTypeItems: MenuItem[] = [
          { 
            label: "🚀 Initial Implementation", 
            value: "initial",
            hint: "First sprint - analyze PRD and build MVP"
          },
          { 
            label: "✨ New Feature", 
            value: "feature",
            hint: "Add new functionality to existing project"
          },
          { 
            label: "🔧 Enhancement", 
            value: "enhancement",
            hint: "Improve existing features"
          },
          { 
            label: "🐛 Bug Fix", 
            value: "bugfix",
            hint: "Fix issues and defects"
          },
          { label: "← Back", value: "back" },
        ];

        return (
          <Box flexDirection="column">
            <Text bold color="cyan">What type of sprint is this?</Text>
            <Text color="gray" dimColor>
              {sprintData.sprintType === "initial" 
                ? "Initial sprints analyze the PRD to generate implementation shards"
                : "Other sprints let you describe specific requirements"}
            </Text>
            <Box marginTop={1}>
              <Menu 
                items={sprintTypeItems} 
                onSelect={(value) => {
                  if (value === "back") {
                    setStep("select-project");
                  } else {
                    const type = value as SprintType;
                    setSprintData(prev => ({ ...prev, sprintType: type }));
                    
                    if (type === "initial") {
                      // Initial sprint: auto-name and skip to analysis
                      setSprintData(prev => ({ 
                        ...prev, 
                        name: "Initial Implementation",
                        description: "Implement MVP based on PRD"
                      }));
                      setStep("analyze-patterns");
                      runAnalyzePrd();
                    } else {
                      // Bug/feature/enhancement: go through name/description/requirements
                      setStep("name");
                    }
                  }
                }}
              />
            </Box>
          </Box>
        );

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
