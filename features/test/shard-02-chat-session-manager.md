# Implement Chat Session Manager

## Required Reading
> **IMPORTANT:** Read this entire shard and ALL linked documents before starting.

- [Chat Protocol](../../docs/design/chat-protocol.md)
- [Droid Module](../../src/lib/droid.ts)
- [Types](../../src/lib/types.ts)

## Context
The chat requires session management to maintain conversation history, handle context, and persist state between messages. This core module will manage the lifecycle of a chat session and provide the foundation for the command-line interface.

## Task
Create src/lib/chat-session.ts that implements: (1) ChatSession class to manage conversation state, (2) Methods to add user/assistant messages, (3) Context window management, (4) Session persistence to disk (optional save/load), (5) Integration with invokeDroid for sending prompts with conversation context.

## New in This Shard
- ChatSession class
- Conversation history management
- Context window handling
- Session persistence interface

## Acceptance Criteria
- [ ] ChatSession class maintains ordered message history
- [ ] Context window limits are enforced
- [ ] Sessions can be saved and loaded from disk
- [ ] Integration with invokeDroid includes conversation context
- [ ] Unit tests cover session lifecycle operations

## Dependencies
<!-- Auto-populated by orchestrator -->
- Creates: src/lib/chat-session.ts
- Depends on: shard-01-design-chat-architecture
- Modifies: None

## Linked Issue
GitHub: #TBD
