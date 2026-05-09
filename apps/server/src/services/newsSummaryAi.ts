function groqChatUrl(): string {
  return process.env.GROQ_API_BASE ?? "https://api.groq.com/openai/v1/chat/completions";
}

function groqModel(): string {
  return process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile";
}

export type NewsAiSummary = {
  summary: string;
  /** Optional short bullets (0–3). */
  bullets: string[];
};

export async function summarizeNewsText(
  text: string,
  apiKey: string | undefined,
): Promise<NewsAiSummary | null> {
  if (!apiKey) return null;
  const clean = text.trim();
  if (clean.length < 80) return null;

  const body: Record<string, unknown> = {
    model: groqModel(),
    messages: [
      {
        role: "system",
        content:
          "You summarize geopolitics/maritime security news for an operations dashboard. Reply with ONLY valid JSON (no markdown) with keys: summary (1-2 sentences, neutral), bullets (array of 0-3 short strings). Avoid speculation.",
      },
      { role: "user", content: clean.slice(0, 14_000) },
    ],
    temperature: 0.2,
    max_tokens: 256,
  };

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
  if (!res.ok) return null;

  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) return null;

  const jsonSlice = extractJsonObject(content);
  if (!jsonSlice) return null;
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(jsonSlice) as Record<string, unknown>;
  } catch {
    return null;
  }

  const bulletsRaw = Array.isArray(j.bullets) ? j.bullets : [];
  const bullets = bulletsRaw
    .map((b) => String(b ?? "").trim())
    .filter(Boolean)
    .slice(0, 3);

  const summary = String(j.summary ?? "").trim();
  if (!summary) return null;
  return { summary, bullets };
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

