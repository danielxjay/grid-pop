import { createClient } from "npm:@supabase/supabase-js@2";
import { crunchMovesMatchPrefix, parseCrunchMoves, replayCrunchRun } from "./run-logic.ts";

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
    const runId = typeof body?.runId === "string" ? body.runId : "";
    const moves = parseCrunchMoves(body?.moves);
    const deviceToken = typeof body?.deviceToken === "string" ? body.deviceToken : null;

    if (!runId || !moves) {
      return json({ error: "A run id and Crunch moves array are required." }, { status: 400 });
    }

    const { data: run, error: runError } = await supabaseAdmin
      .from("crunch_runs")
      .select("id, tray_seed, wall_seed, moves, device_token")
      .eq("id", runId)
      .eq("user_id", authData.user.id)
      .eq("status", "active")
      .maybeSingle();

    if (runError) {
      return json({ error: "Could not load this Crunch run." }, { status: 500 });
    }
    if (!run) {
      return json({ error: "This Crunch run is no longer active." }, { status: 409 });
    }
    if (run.device_token && deviceToken !== run.device_token) {
      return json({ code: "resumed_elsewhere", error: "This Crunch game was resumed on another device." }, { status: 409 });
    }

    const committedMoves = parseCrunchMoves(run.moves) ?? [];
    if (!crunchMovesMatchPrefix(committedMoves, moves)) {
      return json({ error: "Crunch run state is out of sync." }, { status: 409 });
    }

    const replay = replayCrunchRun(run.tray_seed, run.wall_seed, moves, { requireGameOver: false });
    if (!replay.valid || !replay.game) {
      return json({ error: replay.error ?? "Crunch verification failed." }, { status: 400 });
    }

    const { error: updateError } = await supabaseAdmin
      .from("crunch_runs")
      .update({ moves })
      .eq("id", run.id)
      .eq("status", "active");

    if (updateError) {
      return json({ error: "Could not prepare the next Crunch tray." }, { status: 500 });
    }

    return json({
      board: replay.game.board,
      tray: replay.game.tray,
      wallDepth: replay.game.crunchWallDepth,
      nextWaveAtMs: replay.game.nextWaveAtMs,
      criticalUntilMs: replay.game.criticalUntilMs,
      survivalMs: replay.survivalMs,
      poxelsPopped: replay.poxelsPopped,
      gameOver: replay.game.gameOver,
    });
  } catch (error) {
    console.error("Unexpected prepare-crunch-tray failure.", error);
    return json({ error: "Unexpected prepare-crunch-tray failure." }, { status: 500 });
  }
});
