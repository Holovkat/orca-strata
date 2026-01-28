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
  | "existing-shards"    // New: detected existing shards - resume or regenerate?
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
  // UI/UX design fields
  needsUiReview?: boolean;        // Auto-detected or manually set
  uiDesignSpec?: string;          // Generated design specification
  uiReviewStatus?: "pending" | "reviewed" | "aligned";
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
  
  // Shard review state
  type ShardReviewMode = "view" | "edit" | "rescope" | "ui-design" | "alignment";
  const [shardReviewMode, setShardReviewMode] = useState<ShardReviewMode>("view");
  const [editingShardField, setEditingShardField] = useState<string>("");
  const [rescopePrompt, setRescopePrompt] = useState<string>("");
  const [designTemplates, setDesignTemplates] = useState<string>("");
  
  // Existing shards detection
  const [existingShards, setExistingShards] = useState<ShardDraft[]>([]);
  const [existingSprintName, setExistingSprintName] = useState<string>("");

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

  // Rescope a shard with AI based on user feedback
  const runRescopeShard = async (shardIndex: number, feedback: string) => {
    setLoading(true);
    setLoadingMessage("AI is rescoping the shard...");
    setError(null);

    const currentShard = sprintData.shardDrafts[shardIndex];
    if (!currentShard) return;

    try {
      const prompt = `You need to rescope/modify this shard based on user feedback.

## Current Shard
\`\`\`json
${JSON.stringify(currentShard, null, 2)}
\`\`\`

## User Feedback
${feedback}

## Your Task
Modify the shard based on the user's feedback. Keep the same structure but adjust:
- title, task, context as needed
- acceptance criteria
- creates/modifies arrays
- dependencies if scope changed significantly

Return ONLY a single JSON object (not an array) with the updated shard:
\`\`\`json
{
  "id": "${currentShard.id}",
  "title": "...",
  "context": "...",
  "task": "...",
  "type": "...",
  "requiredReading": [...],
  "newInShard": [...],
  "acceptanceCriteria": [...],
  "creates": [...],
  "dependsOn": [...],
  "modifies": [...]
}
\`\`\`

Return ONLY the JSON object, no other text.`;

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
        throw new Error("Failed to rescope shard");
      }

      // Parse the JSON response
      const jsonMatch = result.output.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("Failed to parse rescoped shard from AI response");
      }

      const rescopedShard = JSON.parse(jsonMatch[0]) as ShardDraft;
      
      // Update the shard in the list
      setSprintData((prev) => ({
        ...prev,
        shardDrafts: prev.shardDrafts.map((s, i) => 
          i === shardIndex ? rescopedShard : s
        ),
      }));
      
      setLoading(false);
      setShardReviewMode("view");
      setRescopePrompt("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to rescope shard");
      setLoading(false);
    }
  };

  // Remove a shard from the list
  const removeShard = (shardIndex: number) => {
    setSprintData((prev) => ({
      ...prev,
      shardDrafts: prev.shardDrafts.filter((_, i) => i !== shardIndex),
    }));
    // If we removed the last shard, go back one
    if (currentShardIndex >= sprintData.shardDrafts.length - 1) {
      setCurrentShardIndex(Math.max(0, currentShardIndex - 1));
    }
  };

  // Update a specific field on the current shard
  const updateShardField = (shardIndex: number, field: string, value: string | string[]) => {
    setSprintData((prev) => ({
      ...prev,
      shardDrafts: prev.shardDrafts.map((s, i) => 
        i === shardIndex ? { ...s, [field]: value } : s
      ),
    }));
  };

  // Check for existing shards in a project's features/sprints folder
  const checkExistingShards = async (projectDir: string): Promise<{ sprintName: string; shards: ShardDraft[] } | null> => {
    try {
      const { readdir, readFile, stat } = await import("fs/promises");
      const sprintsDir = join(projectDir, "features", "sprints");
      
      // Check if sprints directory exists
      try {
        await stat(sprintsDir);
      } catch {
        return null;
      }
      
      // Find sprint folders
      const entries = await readdir(sprintsDir);
      const sprintFolders: string[] = [];
      
      for (const entry of entries) {
        const entryPath = join(sprintsDir, entry);
        const entryStat = await stat(entryPath);
        if (entryStat.isDirectory() && !entry.startsWith(".")) {
          sprintFolders.push(entry);
        }
      }
      
      if (sprintFolders.length === 0) return null;
      
      // Get the most recent sprint folder (alphabetically last, assuming naming convention)
      const latestSprint = sprintFolders.sort().pop()!;
      const sprintPath = join(sprintsDir, latestSprint);
      
      // Read shard files
      const shardFiles = await readdir(sprintPath);
      const shards: ShardDraft[] = [];
      
      for (const file of shardFiles) {
        if (!file.endsWith(".md") || file.startsWith(".")) continue;
        
        const content = await readFile(join(sprintPath, file), "utf-8");
        const shard = parseShardContent(content, file.replace(".md", ""));
        if (shard) {
          shards.push(shard);
        }
      }
      
      if (shards.length === 0) return null;
      
      // Sort shards by ID
      shards.sort((a, b) => a.id.localeCompare(b.id));
      
      return { sprintName: latestSprint, shards };
    } catch {
      return null;
    }
  };

  // Parse a shard markdown file into a ShardDraft
  const parseShardContent = (content: string, defaultId: string): ShardDraft | null => {
    try {
      const lines = content.split("\n");
      
      let title = defaultId;
      let context = "";
      let task = "";
      const acceptanceCriteria: string[] = [];
      const creates: string[] = [];
      const dependsOn: string[] = [];
      const modifies: string[] = [];
      const requiredReading: Array<{ label: string; path: string }> = [];
      
      let currentSection = "";
      
      for (const line of lines) {
        if (line.startsWith("# ")) {
          title = line.slice(2).trim();
        } else if (line.startsWith("## ")) {
          currentSection = line.slice(3).trim().toLowerCase();
        } else if (currentSection === "context" && line.trim()) {
          context += (context ? "\n" : "") + line;
        } else if (currentSection === "task" && line.trim()) {
          task += (task ? "\n" : "") + line;
        } else if (currentSection === "acceptance criteria" && line.startsWith("- ")) {
          acceptanceCriteria.push(line.slice(2).replace(/^\[[ x]\]\s*/, "").trim());
        } else if (currentSection === "required reading" && line.startsWith("- ")) {
          const linkMatch = line.match(/\[([^\]]+)\]\(([^)]+)\)/);
          if (linkMatch && linkMatch[1] && linkMatch[2]) {
            requiredReading.push({ label: linkMatch[1], path: linkMatch[2] });
          }
        } else if (currentSection === "dependencies") {
          if (line.includes("Creates:")) {
            const items = line.split("Creates:")[1]?.split(",").map(s => s.trim()).filter(Boolean) || [];
            creates.push(...items);
          } else if (line.includes("Depends on:")) {
            const items = line.split("Depends on:")[1]?.split(",").map(s => s.trim()).filter(Boolean) || [];
            dependsOn.push(...items);
          } else if (line.includes("Modifies:")) {
            const items = line.split("Modifies:")[1]?.split(",").map(s => s.trim()).filter(Boolean) || [];
            modifies.push(...items);
          }
        }
      }
      
      // Determine type from content
      const allContent = `${title} ${task} ${creates.join(" ")}`.toLowerCase();
      let type: ShardDraft["type"] = "fullstack";
      if (allContent.includes("docs/") || allContent.includes("documentation")) {
        type = "docs";
      } else if (allContent.includes("api") || allContent.includes("backend") || allContent.includes("convex")) {
        type = allContent.includes("component") || allContent.includes("frontend") ? "fullstack" : "backend";
      } else if (allContent.includes("component") || allContent.includes("frontend") || allContent.includes(".tsx")) {
        type = "frontend";
      }
      
      return {
        id: defaultId,
        title,
        context: context.trim(),
        task: task.trim(),
        type,
        requiredReading,
        newInShard: [],
        acceptanceCriteria,
        creates,
        dependsOn,
        modifies,
      };
    } catch {
      return null;
    }
  };

  // Load global design templates
  const loadDesignTemplates = async (): Promise<string> => {
    if (designTemplates) return designTemplates;
    
    const templatesPath = config.design?.templates_path;
    if (!templatesPath) return "";
    
    try {
      const { readdir, readFile } = await import("fs/promises");
      const { join } = await import("path");
      const { homedir } = await import("os");
      
      // Expand ~ in path
      const fullPath = templatesPath.startsWith("~/") 
        ? join(homedir(), templatesPath.slice(2))
        : templatesPath;
      
      const files = await readdir(fullPath);
      const contents: string[] = [];
      
      for (const file of files) {
        if (file.endsWith(".md")) {
          const content = await readFile(join(fullPath, file), "utf-8");
          contents.push(`## ${file}\n${content}`);
        }
      }
      
      const templates = contents.join("\n\n---\n\n");
      setDesignTemplates(templates);
      return templates;
    } catch {
      return "";
    }
  };

  // Check if a shard needs UI/UX review
  const shardNeedsUiReview = (shard: ShardDraft): boolean => {
    if (shard.needsUiReview !== undefined) return shard.needsUiReview;
    
    // Auto-detect based on type and content
    if (shard.type === "backend" || shard.type === "docs") return false;
    
    const uiIndicators = [
      "component", "page", "screen", "ui", "view", "layout",
      "form", "button", "modal", "dialog", "panel", "card",
      ".tsx", "react", "frontend", "interface", "display"
    ];
    
    const content = `${shard.title} ${shard.task} ${shard.creates.join(" ")}`.toLowerCase();
    return uiIndicators.some(indicator => content.includes(indicator));
  };

  // Generate UI design spec for a shard using AI
  const runGenerateUiDesign = async (shardIndex: number) => {
    setLoading(true);
    setLoadingMessage("Generating UI/UX design specification...");
    setError(null);

    const shard = sprintData.shardDrafts[shardIndex];
    if (!shard) return;

    try {
      const templates = await loadDesignTemplates();
      
      const prompt = `You are a UI/UX designer creating detailed design specifications for a development shard.

## Design Guidelines Location
The project has UI/UX guidelines at: docs/design/ui-ux-guidelines/
These include:
- design-tokens.md / design-tokens.json - Colors, spacing, typography tokens
- component-patterns.md - Component design patterns
- form-patterns.md - Form design patterns
- layout-patterns.md - Layout patterns
- interactive-patterns.md - Interactive patterns
- data-display-patterns.md - Data display patterns

## Global Design System Reference
${templates || "No additional global templates configured."}

## Shard to Design
Title: ${shard.title}
Task: ${shard.task}
Context: ${shard.context}
Creates: ${shard.creates.join(", ")}

## Your Task
Create a detailed UI/UX specification for this shard that a developer can implement exactly.
Reference the project's design guidelines (docs/design/ui-ux-guidelines/) and include:

1. **Component Structure**: List each component/screen with hierarchy
2. **Layout**: Exact layout specifications using design tokens (flexbox/grid, spacing, dimensions)
3. **Colors**: Specific color values from design-tokens.md
4. **Typography**: Font sizes, weights, line heights from design tokens
5. **States**: All interactive states (hover, focus, active, disabled, loading, error)
6. **Responsive**: Behavior at different breakpoints
7. **Interactions**: Animations, transitions, user feedback per interactive-patterns.md
8. **Accessibility**: ARIA labels, keyboard navigation, contrast requirements

Format as markdown that can be included in the shard document.
Include file references like: See [Design Tokens](../docs/design/ui-ux-guidelines/design-tokens.md)`;

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
        throw new Error("Failed to generate UI design spec");
      }

      // Update shard with design spec
      setSprintData((prev) => ({
        ...prev,
        shardDrafts: prev.shardDrafts.map((s, i) => 
          i === shardIndex 
            ? { ...s, uiDesignSpec: result.output, uiReviewStatus: "reviewed" as const }
            : s
        ),
      }));
      
      setLoading(false);
      setShardReviewMode("view");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate UI design");
      setLoading(false);
    }
  };

  // Run alignment review to ensure design + functionality are achievable
  const runAlignmentReview = async (shardIndex: number) => {
    setLoading(true);
    setLoadingMessage("Reviewing shard alignment (design + functionality)...");
    setError(null);

    const shard = sprintData.shardDrafts[shardIndex];
    if (!shard) return;

    try {
      const prompt = `You are reviewing a shard for alignment between UI design and functionality.

## Shard Details
Title: ${shard.title}
Task: ${shard.task}
Context: ${shard.context}
Type: ${shard.type}
Creates: ${shard.creates.join(", ")}
Depends On: ${shard.dependsOn.join(", ")}

## Acceptance Criteria
${shard.acceptanceCriteria.map(c => `- ${c}`).join("\n")}

## UI Design Specification
${shard.uiDesignSpec || "No UI design spec yet."}

## Your Task
Review this shard and provide:

1. **Alignment Check**: Are the UI specs and functionality aligned?
2. **Scope Assessment**: Is this achievable in a single atomic shard?
3. **Dependencies**: Are all required dependencies listed?
4. **Gaps**: Any missing acceptance criteria or design details?
5. **Recommendations**: Suggested adjustments (if any)

If adjustments are needed, provide an updated shard JSON:
\`\`\`json
{
  "title": "...",
  "task": "...",
  "acceptanceCriteria": [...],
  // ... other fields that need updating
}
\`\`\`

Otherwise just say "ALIGNED - No changes needed."`;

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
        throw new Error("Failed to run alignment review");
      }

      // Check if changes were suggested
      const jsonMatch = result.output.match(/```json\s*([\s\S]*?)\s*```/);
      if (jsonMatch && jsonMatch[1]) {
        try {
          const updates = JSON.parse(jsonMatch[1]);
          // Merge updates into shard
          setSprintData((prev) => ({
            ...prev,
            shardDrafts: prev.shardDrafts.map((s, i) => 
              i === shardIndex 
                ? { ...s, ...updates, uiReviewStatus: "aligned" as const }
                : s
            ),
          }));
        } catch {
          // JSON parse failed, just mark as aligned
          setSprintData((prev) => ({
            ...prev,
            shardDrafts: prev.shardDrafts.map((s, i) => 
              i === shardIndex 
                ? { ...s, uiReviewStatus: "aligned" as const }
                : s
            ),
          }));
        }
      } else {
        // No changes needed
        setSprintData((prev) => ({
          ...prev,
          shardDrafts: prev.shardDrafts.map((s, i) => 
            i === shardIndex 
              ? { ...s, uiReviewStatus: "aligned" as const }
              : s
          ),
        }));
      }
      
      setLoading(false);
      setShardReviewMode("view");
      setDroidOutput(result.output); // Show the review output
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to run alignment review");
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
            // Check for existing shards first
            const existingShardsResult = await checkExistingShards(projectPath);
            if (existingShardsResult) {
              setExistingShards(existingShardsResult.shards);
              setExistingSprintName(existingShardsResult.sprintName);
              setStep("existing-shards");
              return;
            }
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
            // Check for existing shards first
            const existingShardsResult = await checkExistingShards(newPath);
            if (existingShardsResult) {
              setExistingShards(existingShardsResult.shards);
              setExistingSprintName(existingShardsResult.sprintName);
              setStep("existing-shards");
              return;
            }
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

      case "existing-shards":
        const existingShardMenuItems: MenuItem[] = [
          {
            label: "📝 Resume Review",
            value: "resume",
            hint: `Continue reviewing ${existingShards.length} shards from "${existingSprintName}"`,
          },
          {
            label: "🔄 Regenerate Shards",
            value: "regenerate",
            hint: "Analyze PRD again and create new shards",
          },
          {
            label: "🗑️ Start Fresh",
            value: "fresh",
            hint: "Ignore existing shards and start a new sprint",
          },
          {
            label: "← Back",
            value: "back",
          },
        ];

        return (
          <Box flexDirection="column">
            <Text bold color="cyan">Existing Shards Detected</Text>
            <Text color="yellow">
              Found {existingShards.length} shards in sprint "{existingSprintName}"
            </Text>
            <Box marginTop={1} flexDirection="column" paddingLeft={1}>
              {existingShards.slice(0, 5).map((shard, i) => (
                <Text key={i} color="gray">• {shard.id}: {shard.title}</Text>
              ))}
              {existingShards.length > 5 && (
                <Text color="gray" dimColor>...and {existingShards.length - 5} more</Text>
              )}
            </Box>
            <Box marginTop={1}>
              <Menu
                items={existingShardMenuItems}
                onSelect={async (value) => {
                  if (value === "back") {
                    setStep("select-project");
                  } else if (value === "resume") {
                    // Load existing shards into sprint data and go to review
                    setSprintData((prev) => ({
                      ...prev,
                      name: existingSprintName,
                      shardDrafts: existingShards,
                    }));
                    setCurrentShardIndex(0);
                    setStep("review-shards");
                  } else if (value === "regenerate") {
                    // Clear existing and regenerate from PRD
                    setExistingShards([]);
                    setSprintData((prev) => ({
                      ...prev,
                      name: existingSprintName,
                      shardDrafts: [],
                    }));
                    // Check if PRD exists
                    const hasPrdResult = await hasPrd(selectedProjectPath);
                    if (hasPrdResult) {
                      setProjectHasPrd(true);
                      // Go directly to analyze PRD
                      setStep("analyze-patterns");
                      await runAnalyzePrd();
                    } else {
                      setProjectHasPrd(false);
                      setStep("prd-qa");
                    }
                  } else if (value === "fresh") {
                    // Ignore existing, start fresh sprint workflow
                    setExistingShards([]);
                    const hasPrdResult = await hasPrd(selectedProjectPath);
                    setProjectHasPrd(hasPrdResult);
                    setStep(hasPrdResult ? "sprint-type" : "prd-qa");
                  }
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
        
        // Handle empty shards list
        if (sprintData.shardDrafts.length === 0) {
          return (
            <Box flexDirection="column">
              <StatusMessage type="error" message="No shards to review. All shards were removed." />
              <Box marginTop={1}>
                <Text color="gray">Press Esc to go back and try again.</Text>
              </Box>
            </Box>
          );
        }
        
        if (!currentShard) return null;

        // Rescope mode - ask AI to modify the shard
        if (shardReviewMode === "rescope") {
          return (
            <Box flexDirection="column">
              <Text bold color="cyan">Rescope Shard: {currentShard.title}</Text>
              <Text color="gray" dimColor>Tell the AI how you want this shard changed</Text>
              <Box marginTop={1}>
                <QuestionPrompt
                  question="What changes do you want? (e.g., 'make it smaller', 'focus only on X', 'split into backend and frontend')"
                  type="text"
                  onAnswer={(answer) => {
                    if (answer.trim()) {
                      runRescopeShard(currentShardIndex, answer);
                    } else {
                      setShardReviewMode("view");
                    }
                  }}
                  onCancel={() => setShardReviewMode("view")}
                />
              </Box>
            </Box>
          );
        }

        // Edit mode - manually edit a field
        if (shardReviewMode === "edit" && editingShardField) {
          const fieldValue = (currentShard as unknown as Record<string, unknown>)[editingShardField];
          const isArrayField = Array.isArray(fieldValue);
          
          return (
            <Box flexDirection="column">
              <Text bold color="cyan">Edit: {editingShardField}</Text>
              <Text color="gray" dimColor>Current value: {isArrayField ? (fieldValue as string[]).join(", ") : String(fieldValue)}</Text>
              <Box marginTop={1}>
                <QuestionPrompt
                  question={isArrayField ? "Enter new values (comma-separated):" : "Enter new value:"}
                  type="text"
                  onAnswer={(answer) => {
                    const newValue = isArrayField 
                      ? answer.split(",").map(s => s.trim()).filter(Boolean)
                      : answer;
                    updateShardField(currentShardIndex, editingShardField, newValue);
                    setShardReviewMode("view");
                    setEditingShardField("");
                  }}
                  onCancel={() => {
                    setShardReviewMode("view");
                    setEditingShardField("");
                  }}
                />
              </Box>
            </Box>
          );
        }

        // View mode - show shard details with action menu
        const needsUi = shardNeedsUiReview(currentShard);
        const hasDesignSpec = !!currentShard.uiDesignSpec;
        const isAligned = currentShard.uiReviewStatus === "aligned";
        
        const shardReviewMenuItems: MenuItem[] = [
          { label: "✓ Approve & Next", value: "approve", hint: "Accept this shard and continue" },
          { label: "✎ Edit Field", value: "edit", hint: "Manually edit a specific field" },
          { label: "🔄 AI Rescope", value: "rescope", hint: "Ask AI to modify this shard" },
          { label: "✗ Reject & Remove", value: "reject", hint: "Remove this shard entirely" },
        ];
        
        // Add UI design options if this shard needs UI/UX input
        if (needsUi && config.design?.templates_path) {
          shardReviewMenuItems.push(
            { label: "─────────────", value: "divider-design", disabled: true },
            { 
              label: hasDesignSpec ? "🎨 Regenerate UI Design" : "🎨 Generate UI Design", 
              value: "ui-design", 
              hint: "Create detailed UI/UX specification" 
            },
            { 
              label: "⚖️ Alignment Review", 
              value: "alignment", 
              hint: "Check design + functionality alignment",
              disabled: !hasDesignSpec
            }
          );
        }
        
        shardReviewMenuItems.push(
          { label: "─────────────", value: "divider", disabled: true },
          { label: "← Previous Shard", value: "prev", disabled: currentShardIndex === 0 },
          { label: "→ Skip to Next", value: "next", disabled: currentShardIndex >= sprintData.shardDrafts.length - 1 },
          { label: "─────────────", value: "divider2", disabled: true },
          { label: "✓✓ Approve All Remaining", value: "approve-all", hint: "Skip review for remaining shards" }
        );

        const editableFields: MenuItem[] = [
          { label: "title", value: "title" },
          { label: "task", value: "task" },
          { label: "context", value: "context" },
          { label: "type", value: "type" },
          { label: "acceptanceCriteria", value: "acceptanceCriteria" },
          { label: "creates", value: "creates" },
          { label: "modifies", value: "modifies" },
          { label: "dependsOn", value: "dependsOn" },
          { label: "← Back", value: "back" },
        ];

        return (
          <Box flexDirection="column">
            <Box marginBottom={1}>
              <Text bold color="cyan">
                Review Shard {currentShardIndex + 1}/{sprintData.shardDrafts.length}
              </Text>
              {currentShard.id === "shard-00-architecture" && (
                <Text color="yellow"> (required)</Text>
              )}
            </Box>
            
            <Box flexDirection="column" marginBottom={1} paddingX={1} borderStyle="single" borderColor="gray">
              <Text bold color="green">{currentShard.title}</Text>
              <Text color="gray">ID: {currentShard.id} | Type: {currentShard.type}</Text>
              
              <Box marginTop={1} flexDirection="column">
                <Text bold>Context:</Text>
                <Text color="gray">{currentShard.context}</Text>
              </Box>
              
              <Box marginTop={1} flexDirection="column">
                <Text bold>Task:</Text>
                <Text>{currentShard.task}</Text>
              </Box>
              
              <Box marginTop={1} flexDirection="column">
                <Text bold>Acceptance Criteria:</Text>
                {currentShard.acceptanceCriteria.map((c, i) => (
                  <Text key={i} color="gray">• {c}</Text>
                ))}
              </Box>
              
              {currentShard.creates.length > 0 && (
                <Box marginTop={1} flexDirection="column">
                  <Text bold>Creates:</Text>
                  <Text color="blue">{currentShard.creates.join(", ")}</Text>
                </Box>
              )}
              
              {currentShard.dependsOn.length > 0 && (
                <Box marginTop={1}>
                  <Text color="yellow">Depends on: {currentShard.dependsOn.join(", ")}</Text>
                </Box>
              )}
              
              {needsUi && (
                <Box marginTop={1}>
                  <Text color="magenta">
                    🎨 UI/UX: {
                      isAligned ? "✓ Aligned" : 
                      hasDesignSpec ? "Has design spec (not aligned)" : 
                      "Needs design"
                    }
                  </Text>
                </Box>
              )}
              
              {hasDesignSpec && (
                <Box marginTop={1} flexDirection="column">
                  <Text bold color="magenta">UI Design Spec (preview):</Text>
                  <Text color="gray" dimColor>{currentShard.uiDesignSpec?.slice(0, 200)}...</Text>
                </Box>
              )}
            </Box>
            
            {shardReviewMode === "view" && !editingShardField && (
              <Menu 
                items={shardReviewMenuItems} 
                onSelect={(value) => {
                  if (value === "approve") {
                    handleShardApproval("yes");
                  } else if (value === "edit") {
                    // Show field selection
                    setShardReviewMode("edit");
                  } else if (value === "rescope") {
                    setShardReviewMode("rescope");
                  } else if (value === "reject") {
                    // Don't allow rejecting architecture shard
                    if (currentShard.id === "shard-00-architecture") {
                      setError("Cannot remove the architecture shard - it's required");
                      return;
                    }
                    removeShard(currentShardIndex);
                  } else if (value === "ui-design") {
                    runGenerateUiDesign(currentShardIndex);
                  } else if (value === "alignment") {
                    runAlignmentReview(currentShardIndex);
                  } else if (value === "prev") {
                    setCurrentShardIndex(prev => Math.max(0, prev - 1));
                  } else if (value === "next") {
                    setCurrentShardIndex(prev => Math.min(sprintData.shardDrafts.length - 1, prev + 1));
                  } else if (value === "approve-all") {
                    // Skip to create board
                    setStep("create-board");
                    runCreateBoard();
                  }
                }}
              />
            )}
            
            {shardReviewMode === "edit" && !editingShardField && (
              <Box flexDirection="column">
                <Text bold color="cyan">Select field to edit:</Text>
                <Menu 
                  items={editableFields} 
                  onSelect={(value) => {
                    if (value === "back") {
                      setShardReviewMode("view");
                    } else {
                      setEditingShardField(value);
                    }
                  }}
                  onCancel={() => setShardReviewMode("view")}
                />
              </Box>
            )}
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
