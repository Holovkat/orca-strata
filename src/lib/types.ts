export type Screen =
  | "main"
  | "new-sprint"
  | "continue-sprint"
  | "view-status"
  | "manual-actions"
  | "settings"
  | "shard-editor";

export type Phase =
  | "planning"
  | "build"
  | "review"
  | "uat"
  | "user-acceptance"
  | "deploy";

export type ColumnName =
  | "Ready to Build"
  | "In Progress"
  | "Ready for Review"
  | "In Review"
  | "Ready for UAT"
  | "UAT in Progress"
  | "User Acceptance"
  | "Done";

export interface OrcaConfig {
  project_name: string;
  repo?: string;
  tracking: {
    mode: "github" | "local" | "both";
    backlog_board: string;
  };
  columns: ColumnName[];
  paths: {
    features: string;
    docs: string;
    worktrees: string;
  };
  droids: {
    model: string;
    auto_level: "low" | "medium" | "high";
  };
  app_url: string;
  branching: {
    pattern: string;
    stack_from: "previous" | "main";
  };
}

export interface Shard {
  id: string;
  title: string;
  file: string;
  issueNumber?: number;
  status: ColumnName;
  type: "backend" | "frontend" | "fullstack" | "docs";
  dependencies: string[];
  creates: string[];
  assignedDroid?: string;
  worktree?: string;
  branch?: string;
}

export interface Sprint {
  id: string;
  name: string;
  board?: string;
  branch: string;
  phase: Phase;
  shards: Shard[];
  epicIssue?: number;
  sprintIssue?: number;
}

export interface SprintStatus {
  sprint: Sprint;
  counts: {
    total: number;
    readyToBuild: number;
    inProgress: number;
    readyForReview: number;
    inReview: number;
    readyForUat: number;
    uatInProgress: number;
    userAcceptance: number;
    done: number;
  };
  activeDroids: ActiveDroid[];
}

export interface ActiveDroid {
  shardId: string;
  droid: string;
  status: "running" | "complete" | "failed";
  startedAt: Date;
}

export interface Question {
  id: string;
  text: string;
  type: "text" | "select" | "confirm";
  options?: string[];
  default?: string;
}

export interface Dependency {
  shardId: string;
  dependsOn: string[];
  creates: string[];
  modifies: string[];
}

export const DEFAULT_CONFIG: OrcaConfig = {
  project_name: "Unnamed Project",
  tracking: {
    mode: "github",
    backlog_board: "Backlog",
  },
  columns: [
    "Ready to Build",
    "In Progress",
    "Ready for Review",
    "In Review",
    "Ready for UAT",
    "UAT in Progress",
    "User Acceptance",
    "Done",
  ],
  paths: {
    features: "features/",
    docs: "docs/design/",
    worktrees: ".worktrees/",
  },
  droids: {
    model: "claude-sonnet-4-5-20250929",
    auto_level: "medium",
  },
  app_url: "http://localhost:3000",
  branching: {
    pattern: "feature/{sprint}-{shard}",
    stack_from: "previous",
  },
};
