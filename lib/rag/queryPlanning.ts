const QUERY_EXPANSIONS: Array<{
  pattern: RegExp;
  additions: string[];
}> = [
  {
    pattern: /\b(project\s*management|project manager|manage projects?)\b/i,
    additions: [
      "project control",
      "project engineer",
      "project lead",
      "schedule management",
      "resource planning",
      "cost control",
    ],
  },
  {
    pattern: /\b(hse|safety|health and safety)\b/i,
    additions: [
      "health safety environment",
      "risk assessment",
      "incident investigation",
      "safety officer",
    ],
  },
  {
    pattern: /\b(drilling|drill)\b/i,
    additions: ["well drilling", "drilling engineer", "offshore drilling"],
  },
  {
    pattern: /\b(chef|cook|kitchen)\b/i,
    additions: ["culinary", "food preparation", "restaurant", "kitchen operations"],
  },
  {
    pattern: /\b(certified|certification|certificate|license|licence)\b/i,
    additions: ["certifications", "training", "qualification", "licensed"],
  },
  {
    pattern: /\b(leadership|lead|supervisor|manager)\b/i,
    additions: ["team lead", "supervised", "managed team", "coordinated team"],
  },
];

function uniqueValues(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function sanitizeQuestionPart(part: string) {
  return part.replace(/^[-*•\d.)\s]+/, "").trim();
}

export function expandRecruiterQuery(question: string) {
  const additions = QUERY_EXPANSIONS.flatMap((expansion) =>
    expansion.pattern.test(question) ? expansion.additions : [],
  );

  return uniqueValues([question, ...additions]).join(" ");
}

export function splitRecruiterQuestion(question: string) {
  const normalized = question.replace(/\s+/g, " ").trim();

  const parts = normalized
    .split(/\s+(?:and|or)\s+(?=(?:who|which|find|show|list|has|have|with|without|candidates?|people|experience|cert|skill|worked|knows)\b)|[;?]\s*/i)
    .map(sanitizeQuestionPart)
    .filter((part) => part.length >= 12);

  if (parts.length <= 1) return [sanitizeQuestionPart(normalized)];

  return uniqueValues(parts).slice(0, 3);
}

export function buildRetrievalQueries(question: string) {
  return splitRecruiterQuestion(question).map(expandRecruiterQuery);
}
