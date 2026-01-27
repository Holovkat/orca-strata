# Integrate Chat Command into CLI

## Required Reading
> **IMPORTANT:** Read this entire shard and ALL linked documents before starting.

- [Chat CLI](../../src/chat-cli.tsx)
- [CLI Entry](../../src/cli.tsx)
- [Config Module](../../src/lib/config.ts)

## Context
The chat interface needs to be accessible as a subcommand in the orca CLI alongside existing commands. This allows users to invoke 'orca chat' to start an interactive droid conversation.

## Task
Modify src/cli.tsx to add a 'chat' subcommand that: (1) Accepts optional --droid flag to specify which droid to use, (2) Accepts optional --session flag to load a saved session, (3) Launches the chat-cli interface, (4) Passes appropriate config and options to chat session.

## New in This Shard
- Chat subcommand in CLI
- Command-line flags for chat mode
- Integration between main CLI and chat interface

## Acceptance Criteria
- [ ] Command 'orca chat' launches interactive chat
- [ ] Flag --droid allows pre-selecting a droid
- [ ] Flag --session loads a saved conversation
- [ ] Help text documents the new subcommand
- [ ] Chat mode receives correct config and context

## Dependencies
<!-- Auto-populated by orchestrator -->
- Creates: N/A
- Depends on: shard-03-chat-cli-interface
- Modifies: src/cli.tsx

## Linked Issue
GitHub: #TBD
