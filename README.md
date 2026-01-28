# Orca

A menu-driven TUI orchestrator that coordinates AI-powered development workflows by invoking droids as background services.

## Installation

```bash
# With bun (recommended)
bun install -g orca-cli

# With npm
npm install -g orca-cli

# From source
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

This launches the interactive TUI where you can:
- Plan and create sprints
- Assign AI droids to work shards
- Monitor build progress
- Review and test implementations
- Deploy completed work

## Configuration

Create `.orchestrator.yaml` in your project root:

```yaml
project_name: "My Project"
tracking:
  mode: "github"
  backlog_board: "Backlog"
droids:
  model: "claude-sonnet-4-5-20250929"
  auto_level: "medium"
app_url: "http://localhost:3000"
```

## Workflow Phases

1. **Planning** - Gather requirements, create shards, create GitHub issues
2. **Build** - Assign droids to shards, monitor completion
3. **Review** - Implementation review, code review, lint/build
4. **UAT** - Browser automation testing
5. **User Acceptance** - Manual user verification
6. **Deploy** - Rebase, push, merge, archive board

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

## License

MIT
