import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAX_SCORES = 100;
const MAX_SCORE_VALUE = 999999;

function normalizeCreatedAt(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
}

function normalizeScoreEntry(entry: unknown) {
  if (typeof entry === "number" || typeof entry === "string") {
    const score = Number.parseInt(String(entry), 10);

    if (!Number.isFinite(score) || score < 0 || score > MAX_SCORE_VALUE) {
      return null;
    }

    return {
      score,
      createdAt: new Date().toISOString(),
    };
  }

  const score = Number.parseInt(String((entry as { score?: unknown })?.score ?? ""), 10);
  const createdAt = normalizeCreatedAt((entry as { createdAt?: unknown })?.createdAt);

  if (!Number.isFinite(score) || score < 0 || score > MAX_SCORE_VALUE || !createdAt) {
    return null;
  }

  return {
    score,
    createdAt,
  };
}

function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
      ...(init?.headers ?? {}),
    },
  });
}

Deno.serve(async (req) => {
  try {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const authHeader = req.headers.get("Authorization") ?? "";

    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
      return json({ error: "Supabase function secrets are missing." }, { status: 500 });
    }

    if (!authHeader) {
      return json({ error: "Missing authorization header." }, { status: 401 });
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey);

    const { data: authData, error: authError } = await supabase.auth.getUser();

    if (authError || !authData.user) {
      return json({ error: "Unauthorized." }, { status: 401 });
    }

    const body = await req.json().catch(() => null);
    const raw = Array.isArray(body?.scores) ? body.scores : null;

    if (!raw) {
      return json({ error: "A scores array is required." }, { status: 400 });
    }

    const scores = raw
      .map(normalizeScoreEntry)
      .filter(Boolean)
      .slice(0, MAX_SCORES);

    if (scores.length === 0) {
      return json({ merged: 0 });
    }

    const rows = scores.map((entry) => ({
      user_id: authData.user.id,
      score: entry.score,
      created_at: entry.createdAt,
    }));

    const { error: insertError } = await supabaseAdmin.from("scores").insert(rows);

    if (insertError) {
      console.error("Score merge failed.", insertError);
      return json({ error: "Could not merge scores." }, { status: 500 });
    }

    return json({ merged: rows.length });
  } catch (error) {
    console.error("Unexpected merge-local-scores failure.", error);
    return json({ error: "Unexpected merge-local-scores failure." }, { status: 500 });
  }
});
