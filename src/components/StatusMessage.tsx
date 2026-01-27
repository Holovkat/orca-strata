import React from "react";
import { Box, Text } from "ink";

type StatusType = "success" | "error" | "warning" | "info";

interface StatusMessageProps {
  type: StatusType;
  message: string;
  detail?: string;
}

const STATUS_ICONS: Record<StatusType, string> = {
  success: "✓",
  error: "✗",
  warning: "⚠",
  info: "ℹ",
};

const STATUS_COLORS: Record<StatusType, string> = {
  success: "green",
  error: "red",
  warning: "yellow",
  info: "blue",
};

export function StatusMessage({ type, message, detail }: StatusMessageProps) {
  return (
    <Box>
      <Text color={STATUS_COLORS[type]}>{STATUS_ICONS[type]} </Text>
      <Text>{message}</Text>
      {detail && <Text color="gray"> - {detail}</Text>}
    </Box>
  );
}
