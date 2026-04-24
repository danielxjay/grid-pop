import { createClient } from "npm:@supabase/supabase-js@2";
import { movesMatchPrefix, parseMoves, replayRun } from "./run-logic.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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

    if (Deno.env.get("MAINTENANCE_MODE")) {
      return json({ error: "Maintenance in progress" }, { status: 503 });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const authHeader = req.headers.get("Authorization") ?? "";

    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
      console.error("Missing Supabase function env vars.");
      return json({ error: "Supabase function secrets are missing." }, { status: 500 });
    }

    if (!authHeader) {
      return json({ error: "Missing authorization header." }, { status: 401 });
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: {
          Authorization: authHeader,
        },
      },
    });
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey);
    const { data: authData, error: authError } = await supabase.auth.getUser();

    if (authError || !authData.user) {
      console.error("Auth lookup failed.", authError);
      return json({ error: "Unauthorized." }, { status: 401 });
    }

    const body = await req.json().catch(() => null);
    const runId = typeof body?.runId === "string" ? body.runId : "";
    const moves = parseMoves(body?.moves);
    const deviceToken = typeof body?.deviceToken === "string" ? body.deviceToken : null;

    if (!runId || !moves) {
      return json({ error: "A run id and moves array are required." }, { status: 400 });
    }

    const { data: run, error: runError } = await supabaseAdmin
      .from("runs")
      .select("id, seed, moves, device_token")
      .eq("id", runId)
      .eq("user_id", authData.user.id)
      .eq("status", "active")
      .maybeSingle();

    if (runError) {
      console.error("Run lookup failed.", runError);
      return json({ error: "Could not load this run." }, { status: 500 });
    }

    if (!run) {
      return json({ error: "This run is no longer active." }, { status: 409 });
    }

    if (run.device_token && deviceToken !== run.device_token) {
      return json({ code: "resumed_elsewhere", error: "This game was resumed on another device." }, { status: 409 });
    }

    const committedMoves = parseMoves(run.moves) ?? [];

    if (movesMatchPrefix(moves, committedMoves)) {
      return json({ moveCount: committedMoves.length });
    }

    if (!movesMatchPrefix(committedMoves, moves)) {
      return json({ error: "Run state is out of sync. Reload to continue from the saved game." }, { status: 409 });
    }

    const replay = replayRun(run.seed, moves, { requireGameOver: false });

    if (!replay.valid || !replay.game) {
      return json({ error: replay.error ?? "Verification failed." }, { status: 400 });
    }

    const { error: updateError } = await supabaseAdmin
      .from("runs")
      .update({ moves })
      .eq("id", run.id)
      .eq("status", "active");

    if (updateError) {
      console.error("Run move sync failed.", updateError);
      return json({ error: "Could not save your latest move." }, { status: 500 });
    }

    return json({ moveCount: moves.length });
  } catch (error) {
    console.error("Unexpected sync-run-move failure.", error);
    return json({ error: "Unexpected sync-run-move failure." }, { status: 500 });
  }
});
