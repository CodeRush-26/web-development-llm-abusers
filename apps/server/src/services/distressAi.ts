import type { AlertSeverity, DistressAnalysis } from "@strait-command/shared";

function groqChatUrl(): string {
  return process.env.GROQ_API_BASE ?? "https://api.groq.com/openai/v1/chat/completions";
}

function groqModel(): string {
  return process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile";
}

export async function analyzeDistressMessage(
  rawMessage: string,
  apiKey: string | undefined,
): Promise<DistressAnalysis> {
  if (apiKey) {
    try {
      const structured = await groqExtract(rawMessage, apiKey);
      if (structured) return structured;
    } catch {
      /* fall through */
    }
  }
  return heuristicAnalysis(rawMessage);
}

/** Groq exposes an OpenAI-compatible Chat Completions API */
async function groqExtract(message: string, apiKey: string): Promise<DistressAnalysis | null> {
  const body: Record<string, unknown> = {
    model: groqModel(),
    messages: [
      {
        role: "system",
        content:
          "You extract maritime distress facts. Reply with ONLY valid JSON, no markdown, with keys: severity (critical|high|medium|low), category (short string), injuryCount (number or null), damageEstimate (string or null), operationalImpact (string), recommendedUrgency (string), summary (one sentence).",
      },
      { role: "user", content: message },
    ],
    temperature: 0.2,
    max_tokens: 512,
  };

  /** Prefer JSON mode when the stack supports it */
  body.response_format = { type: "json_object" };

  const res = await fetch(groqChatUrl(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(25_000),
  });

  if (!res.ok) {
    /** Retry without response_format for older Groq models */
    const retry = await fetch(groqChatUrl(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: groqModel(),
        messages: body.messages,
        temperature: 0.2,
        max_tokens: 512,
      }),
      signal: AbortSignal.timeout(25_000),
    });
    if (!retry.ok) return null;
    return parseGroqContent(await readGroqMessageContent(retry), message);
  }

  return parseGroqContent(await readGroqMessageContent(res), message);
}

async function readGroqMessageContent(res: Response): Promise<string | null> {
  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  return data.choices?.[0]?.message?.content ?? null;
}

function parseGroqContent(text: string | null, originalDistress: string): DistressAnalysis | null {
  if (!text) return null;
  const trimmed = text.trim();
  const jsonSlice = extractJsonObject(trimmed);
  if (!jsonSlice) return null;
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(jsonSlice) as Record<string, unknown>;
  } catch {
    return null;
  }
  return {
    severity: (j.severity as AlertSeverity) ?? "high",
    category: String(j.category ?? "unknown"),
    injuryCount:
      typeof j.injuryCount === "number"
        ? j.injuryCount
        : j.injuryCount == null
          ? null
          : Number(j.injuryCount),
    damageEstimate: j.damageEstimate != null ? String(j.damageEstimate) : null,
    operationalImpact: String(j.operationalImpact ?? "unknown"),
    recommendedUrgency: String(j.recommendedUrgency ?? "immediate"),
    summary: String(j.summary ?? originalDistress.slice(0, 160)),
    rawMessage: originalDistress,
    analyzedAt: Date.now(),
  };
}

/** Strip markdown fences if the model wraps JSON */
function extractJsonObject(s: string): string | null {
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence?.[1]) return fence[1].trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start >= 0 && end > start) return s.slice(start, end + 1);
  return null;
}

function heuristicAnalysis(rawMessage: string): DistressAnalysis {
  const m = rawMessage.toLowerCase();
  let severity: AlertSeverity = "medium";
  if (/\b(fire|flood|sinking|mayday|attack|explosion|collision)\b/.test(m)) {
    severity = "critical";
  } else if (/\b(injur|casualt|medical|hull breach|taking water)\b/.test(m)) {
    severity = "high";
  }
  const injMatch = m.match(/(\d+)\s*(injured|casualties|crew hurt|wounded)/);
  let injuryCount: number | null = injMatch ? parseInt(injMatch[1], 10) : null;
  if (!injuryCount && /\binjured\b/.test(m)) injuryCount = 1;
  let category = "general_distress";
  if (/\bfire\b/.test(m)) category = "fire";
  else if (/\bengine\b/.test(m)) category = "propulsion";
  else if (/\bcollision\b/.test(m)) category = "collision";
  else if (/\bmedical\b/.test(m)) category = "medical";

  return {
    severity,
    category,
    injuryCount,
    damageEstimate: /\b(severe|major)\s+damage\b/.test(m) ? "severe" : null,
    operationalImpact:
      severity === "critical" ? "Mission-critical systems at risk" : "Operational degradation likely",
    recommendedUrgency:
      severity === "critical" ? "Immediate intervention" : "Priority coordination within 15 minutes",
    summary: rawMessage.slice(0, 200),
    rawMessage,
    analyzedAt: Date.now(),
  };
}

/** Maps distress severity to AI priority bump for alert sorting */
export function distressPriorityBoost(analysis: DistressAnalysis): number {
  const base =
    analysis.severity === "critical"
      ? 40
      : analysis.severity === "high"
        ? 28
        : analysis.severity === "medium"
          ? 15
          : 8;
  const inj = analysis.injuryCount ?? 0;
  return Math.min(100, base + inj * 3);
}
