interface AiCheckUpdateOptions {
  checkedAt: string;
  unresolvedIssue?: string;
}

export function richText(content: string) {
  return (content.match(/[\s\S]{1,1900}/g) ?? [content])
    .map((chunk) => ({ type: "text", text: { content: chunk } }));
}

export function buildResolvedAiIssueUpdates(options: {
  existingAiIssue: string;
  humanIssue: string;
  resolvedPrefix: string;
}): Record<string, unknown> {
  if (!options.existingAiIssue.trim().startsWith(options.resolvedPrefix)) return {};
  return {
    "AI Issue": { rich_text: [] },
    ...(options.humanIssue.trim() ? {} : { "Needs Review": { checkbox: false } })
  };
}

export function buildAiCheckUpdates(options: AiCheckUpdateOptions): Record<string, unknown> {
  const updates: Record<string, unknown> = {
    "Last AI Check Time": { date: { start: options.checkedAt } }
  };
  const issue = options.unresolvedIssue?.trim();
  if (issue) {
    updates["AI Issue"] = { rich_text: richText(issue) };
    updates["Needs Review"] = { checkbox: true };
  }
  return updates;
}
