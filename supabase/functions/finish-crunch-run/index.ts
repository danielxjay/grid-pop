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
    const finishedAtMs = Number.parseInt(String(body?.finishedAtMs ?? ""), 10);
    const forceFinish = Boolean(body?.forceFinish);

    if (!runId || !moves || !Number.isInteger(finishedAtMs) || finishedAtMs < 0) {
      return json({ error: "A run id, Crunch moves array, and finishedAtMs are required." }, { status: 400 });
    }

    const { data: run, error: runLookupError } = await supabaseAdmin
      .from("crunch_runs")
      .select("id, tray_seed, wall_seed, moves, device_token")
      .eq("id", runId)
      .eq("user_id", authData.user.id)
      .eq("status", "active")
      .maybeSingle();

    if (runLookupError) {
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

    const verification = replayCrunchRun(run.tray_seed, run.wall_seed, moves, {
      finishedAtMs,
      requireGameOver: !forceFinish,
    });

    if (!verification.valid || !verification.game) {
      await supabaseAdmin
        .from("crunch_runs")
        .update({
          status: "rejected",
          moves,
          rejection_reason: verification.error ?? "Crunch verification failed.",
          finished_at: new Date().toISOString(),
        })
        .eq("id", run.id)
        .eq("status", "active");

      return json({ error: verification.error ?? "Crunch verification failed." }, { status: 400 });
    }

    const { data: claimedRun, error: claimError } = await supabaseAdmin
      .from("crunch_runs")
      .update({
        status: "submitted",
        moves,
        finished_at: new Date().toISOString(),
      })
      .eq("id", run.id)
      .eq("status", "active")
      .select("id")
      .maybeSingle();

    if (claimError) {
      return json({ error: "Could not claim this Crunch run." }, { status: 500 });
    }
    if (!claimedRun) {
      return json({ error: "This Crunch run is no longer active." }, { status: 409 });
    }

    const { error: runUpdateError } = await supabaseAdmin
      .from("crunch_runs")
      .update({
        status: "verified",
        verified_score: verification.score,
        verified_survival_ms: verification.survivalMs,
        verified_poxels_popped: verification.poxelsPopped,
        verified_move_count: verification.moveCount,
        verified_wall_depth: verification.wallDepth,
        verified_lines_cleared: verification.linesCleared,
        verified_best_lines_cleared: verification.bestLinesCleared,
        verified_wall_cells_cleared: verification.wallCellsCleared,
        verified_time_bonus_ms: verification.timeBonusMs,
        verified_critical_escapes: verification.criticalEscapes,
        rejection_reason: null,
      })
      .eq("id", run.id)
      .eq("status", "submitted");

    if (runUpdateError) {
      return json({ error: "Could not finalize this Crunch run." }, { status: 500 });
    }

    const { error: scoreError } = await supabaseAdmin.from("crunch_scores").insert({
      user_id: authData.user.id,
      run_id: run.id,
      score: verification.score,
      survival_ms: verification.survivalMs,
      poxels_popped: verification.poxelsPopped,
      move_count: verification.moveCount,
      wall_depth: verification.wallDepth,
      lines_cleared: verification.linesCleared,
      best_lines_cleared: verification.bestLinesCleared,
      wall_cells_cleared: verification.wallCellsCleared,
      time_bonus_ms: verification.timeBonusMs,
      critical_escapes: verification.criticalEscapes,
    });

    if (scoreError) {
      return json({ error: "Could not record the verified Crunch score." }, { status: 500 });
    }

    return json({
      score: verification.score,
      survivalMs: verification.survivalMs,
      poxelsPopped: verification.poxelsPopped,
      moveCount: verification.moveCount,
      wallDepth: verification.wallDepth,
      linesCleared: verification.linesCleared,
      bestLinesCleared: verification.bestLinesCleared,
      wallCellsCleared: verification.wallCellsCleared,
      timeBonusMs: verification.timeBonusMs,
      criticalEscapes: verification.criticalEscapes,
    });
  } catch (error) {
    console.error("Unexpected finish-crunch-run failure.", error);
    return json({ error: "Unexpected finish-crunch-run failure." }, { status: 500 });
  }
});
