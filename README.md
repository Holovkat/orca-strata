# Orca-Strata

A menu-driven TUI orchestrator that coordinates AI-powered development workflows by invoking droids as background services.

## Why Orca?

Building complex applications with AI agents is powerful—but chaotic. Without coordination:
- **Agents step on each other's work**, causing merge conflicts and lost progress
- **Context gets lost** between sessions, forcing repeated explanations
- **No visibility** into what agents are doing or how far along they are

Orca solves this by treating AI development as a **managed workflow**.

### The Core Insight

> AI works best with well-defined, isolated tasks.

Orca breaks features into **shards**—small, focused units of work with clear boundaries. Each shard runs in its own git worktree, with its own branch, assigned to a specialized droid. This isolation provides **guardrails** that keep agents focused on their task without drifting into unrelated code.

### Why Droids as Services?

Rather than one-shot CLI commands, Orca invokes droids as background services:
- **Persistent context** across tasks within a sprint
- **Parallel execution** across multiple shards simultaneously  
- **Better monitoring** with real-time progress visibility

### Model-Agnostic Orchestration

Orca is a **model-agnostic orchestration layer**. Different shards can use different models based on task complexity. Swap models without changing your workflow.

### Who Is This For?

Anyone building complex applications and features that require **managed agentic development processes**. Whether you're a solo developer multiplying your output or a team coordinating AI-assisted workflows, Orca provides the structure to ship faster without the chaos.

## Installation

```bash
git clone https://github.com/Holovkat/orca-strata.git
cd orca-strata
bun install
bun run build
npm link
```

## Usage

```bash
orca
```

## Architecture Overview

```mermaid
graph TB
    subgraph Orca TUI
        MM[Main Menu]
        NS[New Sprint]
        CS[Continue Sprint]
        VS[View Status]
        MA[Manual Actions]
    end

    subgraph GitHub Integration
        GI[GitHub Issues]
        GP[GitHub Projects]
        PR[Pull Requests]
    end

    subgraph Droid Services
        D1[Backend Droid]
        D2[Frontend Droid]
        D3[Fullstack Droid]
    end

    subgraph Git Worktrees
        WT1[.worktrees/shard-01]
        WT2[.worktrees/shard-02]
        WT3[.worktrees/shard-03]
    end

    MM --> NS
    MM --> CS
    MM --> VS
    MM --> MA

    NS --> GI
    NS --> GP
    CS --> D1 & D2 & D3
    D1 --> WT1
    D2 --> WT2
    D3 --> WT3
    WT1 & WT2 & WT3 --> PR
```

## Workflow Phases

```mermaid
stateDiagram-v2
    [*] --> Planning
    Planning --> Build: Shards created & issues opened
    Build --> Review: All droids complete
    Review --> UAT: Code review passed
    UAT --> UserAcceptance: Automated tests pass
    UserAcceptance --> Deploy: User approves
    Deploy --> [*]: Merged to main

    Build --> Build: Droid working
    Review --> Build: Changes requested
    UAT --> Build: Tests fail
    UserAcceptance --> Build: User rejects
```

### Phase Details

| Phase | Description | Exit Criteria |
|-------|-------------|---------------|
| **Planning** | Gather requirements, break into shards, create GitHub issues | All shards defined with issues |
| **Build** | Assign droids to shards in isolated worktrees | All shards complete |
| **Review** | Code review, lint, typecheck, build verification | All checks pass |
| **UAT** | Automated browser testing | Tests pass |
| **User Acceptance** | Manual user verification | User approves |
| **Deploy** | Rebase stack, push, merge PRs | Merged to main |

## Shard Lifecycle

```mermaid
stateDiagram-v2
    [*] --> ReadyToBuild: Issue created
    ReadyToBuild --> InProgress: Droid assigned
    InProgress --> ReadyForReview: Droid completes
    ReadyForReview --> InReview: Review started
    InReview --> ReadyForUAT: Review approved
    InReview --> InProgress: Changes requested
    ReadyForUAT --> UATInProgress: UAT started
    UATInProgress --> UserAcceptance: UAT passed
    UATInProgress --> InProgress: UAT failed
    UserAcceptance --> Done: User approved
    UserAcceptance --> InProgress: User rejected
    Done --> [*]
```

## Project Structure

```
your-project/
├── .orchestrator.yaml      # Orca configuration
├── features/
│   └── sprint-name/
│       ├── prd.md                    # Product requirements
│       ├── shard-00-architecture.md  # Architecture shard (always first)
│       ├── shard-01-*.md             # Implementation shards
│       ├── shard-02-*.md
│       └── sprint-state.json         # Sprint state tracking
├── .worktrees/                       # Isolated droid workspaces
│   ├── sprint-name-shard-01/
│   ├── sprint-name-shard-02/
│   └── sprint-name-shard-03/
└── src/                              # Your source code
```

## Git Worktrees

Orca uses git worktrees to provide isolated environments for each droid:

```mermaid
graph LR
    subgraph Main Repo
        M[main branch]
    end

    subgraph Worktrees
        W1[".worktrees/shard-01<br/>feature/sprint-shard-01"]
        W2[".worktrees/shard-02<br/>feature/sprint-shard-02"]
        W3[".worktrees/shard-03<br/>feature/sprint-shard-03"]
    end

    M --> W1
    M --> W2
    M --> W3
```

**Benefits:**
- Droids work in parallel without conflicts
- Each shard has its own branch
- Changes are isolated until review
- Easy cleanup after sprint completion

## Graphite-Style Branch Stacking

Branches are stacked sequentially, not all from main:

```mermaid
gitGraph
    commit id: "main"
    branch feature/sprint-shard-01
    commit id: "shard-01 work"
    branch feature/sprint-shard-02
    commit id: "shard-02 work"
    branch feature/sprint-shard-03
    commit id: "shard-03 work"
```

This allows:
- Dependent shards to build on previous work
- Clean rebase operations
- Sequential PR merging

## GitHub Integration

### Issues

Each shard becomes a GitHub issue with:
- Title from shard name
- Body from shard spec
- Labels: `shard`, `sprint:<name>`, `type:<backend|frontend|fullstack>`
- Linked to sprint epic issue

### Project Boards

Orca creates/uses GitHub Projects (Kanban) with columns:

```
Ready to Build → In Progress → Ready for Review → In Review → Ready for UAT → UAT in Progress → User Acceptance → Done
```

Issue cards move automatically as shard status changes.

## Configuration

Create `.orchestrator.yaml` in your project root:

```yaml
project_name: "My Project"
repo: "owner/repo"

tracking:
  mode: "github"           # github | local | both
  backlog_board: "Backlog"

paths:
  features: "features/"
  docs: "docs/design/"
  worktrees: ".worktrees/"

droids:
  model: "claude-sonnet-4-5-20250929"
  auto_level: "medium"     # low | medium | high

app_url: "http://localhost:3000"

branching:
  pattern: "feature/{sprint}-{shard}"
  stack_from: "previous"   # previous | main
```

## Droid Assignment

Droids are assigned based on shard type:

| Shard Type | Assigned Droid |
|------------|----------------|
| `backend` | senior-backend-engineer |
| `frontend` | frontend-developer |
| `fullstack` | fullstack-developer |
| `docs` | documentation-specialist |

## Development

```bash
bun run dev          # Run in development
bun run build        # Build for distribution
bun run typecheck    # Type check
```

## Tech Stack

- **Runtime**: Bun
- **UI**: Ink (React for terminal) + React 19
- **Language**: TypeScript
- **CLI**: Commander
- **VCS**: Git with worktrees
- **Tracking**: GitHub Issues & Projects

## License

MIT
