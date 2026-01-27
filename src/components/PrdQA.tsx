import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { MultiLineInput } from "./MultiLineInput.js";
import { Menu, type MenuItem } from "./Menu.js";

export interface PrdAnswers {
  projectDescription: string;
  targetUsers: string;
  problemSolved: string;
  coreFeatures: string;
  techStack: string;
  constraints: string;
}

const QUESTIONS: Array<{ key: keyof PrdAnswers; question: string; hint: string }> = [
  {
    key: "projectDescription",
    question: "What is this project?",
    hint: "Describe the project in a few sentences - what it does and why it exists",
  },
  {
    key: "targetUsers",
    question: "Who is it for?",
    hint: "Describe the target users - developers, end users, businesses, etc.",
  },
  {
    key: "problemSolved",
    question: "What problem does it solve?",
    hint: "What pain points or needs does this address?",
  },
  {
    key: "coreFeatures",
    question: "What are the core features (MVP)?",
    hint: "List the essential features needed for a minimal viable product",
  },
  {
    key: "techStack",
    question: "What tech stack should be used?",
    hint: "Languages, frameworks, databases, etc. Or say 'AI decide' to let the droid choose",
  },
  {
    key: "constraints",
    question: "Any constraints or requirements?",
    hint: "Must-haves, can't-haves, budget, timeline, compatibility, etc.",
  },
];

interface PrdQAProps {
  projectName: string;
  projectPath?: string; // For @ file references
  initialAnswers?: Partial<PrdAnswers>;
  onComplete: (answers: PrdAnswers) => void;
  onCancel: () => void;
}

type Mode = "asking" | "review";

export function PrdQA({ projectName, projectPath, initialAnswers, onComplete, onCancel }: PrdQAProps) {
  const [mode, setMode] = useState<Mode>("asking");
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [answers, setAnswers] = useState<PrdAnswers>({
    projectDescription: initialAnswers?.projectDescription || "",
    targetUsers: initialAnswers?.targetUsers || "",
    problemSolved: initialAnswers?.problemSolved || "",
    coreFeatures: initialAnswers?.coreFeatures || "",
    techStack: initialAnswers?.techStack || "",
    constraints: initialAnswers?.constraints || "",
  });
  const [currentInput, setCurrentInput] = useState("");
  const [editingKey, setEditingKey] = useState<keyof PrdAnswers | null>(null);
  const [filePickerOpen, setFilePickerOpen] = useState(false);

  const handleAnswerSubmit = (value: string) => {
    const question = QUESTIONS[currentQuestion];
    if (!question) return;

    setAnswers(prev => ({ ...prev, [question.key]: value }));
    setCurrentInput("");

    if (currentQuestion < QUESTIONS.length - 1) {
      setCurrentQuestion(prev => prev + 1);
    } else {
      // All questions answered, go to review
      setMode("review");
    }
  };

  const handleEditSubmit = (value: string) => {
    if (editingKey) {
      setAnswers(prev => ({ ...prev, [editingKey]: value }));
      setEditingKey(null);
      setCurrentInput("");
    }
  };

  // Review mode
  if (mode === "review") {
    if (editingKey) {
      const questionObj = QUESTIONS.find(q => q.key === editingKey);
      return (
        <Box flexDirection="column">
          <Text bold color="cyan">Edit: {questionObj?.question}</Text>
          <Text color="gray" dimColor>{questionObj?.hint}</Text>
          <Box marginTop={1}>
            <MultiLineInput
              value={currentInput || answers[editingKey]}
              onChange={setCurrentInput}
              onSubmit={handleEditSubmit}
              onCancel={() => {
                if (!filePickerOpen) {
                  setEditingKey(null);
                  setCurrentInput("");
                }
              }}
              minHeight={5}
              projectPath={projectPath}
              onFilePickerChange={setFilePickerOpen}
            />
          </Box>
        </Box>
      );
    }

    const menuItems: MenuItem[] = [
      ...QUESTIONS.map((q, i) => {
        const answer = answers[q.key] || "";
        const firstLine = answer.split("\n")[0] || "";
        return {
          label: `${i + 1}. ${q.question}`,
          value: q.key,
          hint: firstLine.slice(0, 40) + (answer.length > 40 ? "..." : ""),
        };
      }),
      { label: "─────────────", value: "divider", disabled: true },
      { label: "✓ Looks good - Generate PRD", value: "confirm" },
      { label: "✗ Cancel", value: "cancel" },
    ];

    return (
      <Box flexDirection="column">
        <Text bold color="cyan">PRD Review - {projectName}</Text>
        <Text color="gray" dimColor>Select an answer to edit, or confirm to generate PRD</Text>
        
        <Box marginTop={1} flexDirection="column">
          {QUESTIONS.map((q, i) => (
            <Box key={q.key} flexDirection="column" marginBottom={1}>
              <Text bold color="yellow">{i + 1}. {q.question}</Text>
              <Box marginLeft={2} flexDirection="column">
                {answers[q.key].split("\n").map((line, j) => (
                  <Text key={j} color="white">{line}</Text>
                ))}
              </Box>
            </Box>
          ))}
        </Box>

        <Box marginTop={1}>
          <Menu
            items={menuItems}
            onSelect={(value) => {
              if (value === "confirm") {
                onComplete(answers);
              } else if (value === "cancel") {
                onCancel();
              } else if (value !== "divider") {
                setEditingKey(value as keyof PrdAnswers);
                setCurrentInput(answers[value as keyof PrdAnswers]);
              }
            }}
          />
        </Box>
      </Box>
    );
  }

  // Asking mode - show conversation history + current question
  const question = QUESTIONS[currentQuestion];
  if (!question) return null;

  return (
    <Box flexDirection="column">
      <Text bold color="cyan">PRD Q&A - {projectName}</Text>
      <Text color="gray" dimColor>Question {currentQuestion + 1} of {QUESTIONS.length}</Text>

      {/* Show previous answers */}
      {currentQuestion > 0 && (
        <Box marginTop={1} flexDirection="column">
          {QUESTIONS.slice(0, currentQuestion).map((q, i) => (
            <Box key={q.key} flexDirection="column" marginBottom={1}>
              <Text color="gray">{q.question}</Text>
              <Box marginLeft={2}>
                <Text color="green">{answers[q.key].split("\n")[0]}{answers[q.key].includes("\n") ? "..." : ""}</Text>
              </Box>
            </Box>
          ))}
        </Box>
      )}

      {/* Current question */}
      <Box marginTop={1} flexDirection="column">
        <Text bold color="yellow">{question.question}</Text>
        <Text color="gray" dimColor>{question.hint}</Text>
        <Box marginTop={1}>
          <MultiLineInput
            value={currentInput}
            onChange={setCurrentInput}
            onSubmit={handleAnswerSubmit}
            onCancel={() => {
              if (!filePickerOpen) {
                onCancel();
              }
            }}
            placeholder="Type your answer... (@ to reference files)"
            minHeight={4}
            projectPath={projectPath}
            onFilePickerChange={setFilePickerOpen}
          />
        </Box>
      </Box>

      <Box marginTop={1}>
        <Text color="gray">
          Progress: {currentQuestion + 1}/{QUESTIONS.length}
        </Text>
      </Box>
    </Box>
  );
}
