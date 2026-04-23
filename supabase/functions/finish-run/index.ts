import { createClient } from "npm:@supabase/supabase-js@2";
import { movesMatchPrefix, parseMoves, replayRun } from "./run-logic.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAX_MOVES = 512;
const RETAINED_MOVE_LOG_RUNS = 5;

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

async function pruneOldMoveLogs(supabaseAdmin: ReturnType<typeof createClient>, userId: string) {
  const { data: runs, error: runsError } = await supabaseAdmin
    .from("runs")
    .select("id")
    .eq("user_id", userId)
    .in("status", ["verified", "rejected"])
    .not("finished_at", "is", null)
    .order("finished_at", { ascending: false })
    .order("started_at", { ascending: false });

  if (runsError) {
    console.error("Move log retention lookup failed.", runsError);
    return;
  }

  const staleRunIds = (runs ?? []).slice(RETAINED_MOVE_LOG_RUNS).map((run) => run.id);

  if (staleRunIds.length === 0) {
    return;
  }

  const { error: pruneError } = await supabaseAdmin
    .from("runs")
    .update({ moves: [] })
    .in("id", staleRunIds);

  if (pruneError) {
    console.error("Move log pruning failed.", pruneError);
  }
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
    const moves = parseMoves(body?.moves, MAX_MOVES);

    if (!runId || !moves) {
      return json({ error: "A run id and moves array are required." }, { status: 400 });
    }

    const { data: run, error: runLookupError } = await supabaseAdmin
      .from("runs")
      .select("id, seed, moves")
      .eq("id", runId)
      .eq("user_id", authData.user.id)
      .eq("status", "active")
      .maybeSingle();

    if (runLookupError) {
      console.error("Run lookup failed.", runLookupError);
      return json({ error: "Could not load this run." }, { status: 500 });
    }

    if (!run) {
      return json({ error: "This run is no longer active." }, { status: 409 });
    }

    const committedMoves = parseMoves(run.moves, MAX_MOVES) ?? [];

    if (!movesMatchPrefix(committedMoves, moves)) {
      return json({ error: "Run state is out of sync. Reload the board and finish the current path before submitting." }, { status: 409 });
    }

    const verification = replayRun(run.seed, moves, { requireGameOver: true });

    if (!verification.valid || !verification.game) {
      await supabaseAdmin
        .from("runs")
        .update({
          status: "rejected",
          moves,
          rejection_reason: verification.error ?? "Verification failed.",
          finished_at: new Date().toISOString(),
        })
        .eq("id", run.id)
        .eq("status", "active");

      await pruneOldMoveLogs(supabaseAdmin, authData.user.id);

      return json({ error: verification.error ?? "Verification failed." }, { status: 400 });
    }

    const game = verification.game;
    const score = game.score ?? 0;

    const { data: claimedRun, error: claimError } = await supabaseAdmin
      .from("runs")
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
      console.error("Run claim failed.", claimError);
      return json({ error: "Could not claim this run." }, { status: 500 });
    }

    if (!claimedRun) {
      return json({ error: "This run is no longer active." }, { status: 409 });
    }

    const { error: runUpdateError } = await supabaseAdmin
      .from("runs")
      .update({
        status: "verified",
        verified_score: score,
        rejection_reason: null,
      })
      .eq("id", run.id)
      .eq("status", "submitted");

    if (runUpdateError) {
      console.error("Run verification update failed.", runUpdateError);
      return json({ error: "Could not finalize this run." }, { status: 500 });
    }

    const { error: scoreError } = await supabaseAdmin.from("scores").insert({
      user_id: authData.user.id,
      run_id: run.id,
      score,
      best_combo: game.bestCombo,
      best_move_score: game.bestMoveScore,
      best_lines_cleared: game.bestLinesCleared,
      move_count: game.moveCount,
    });

    if (scoreError) {
      console.error("Verified score insert failed.", scoreError);
      return json({ error: "Could not record the verified score." }, { status: 500 });
    }

    await pruneOldMoveLogs(supabaseAdmin, authData.user.id);

    return json({ score });
  } catch (error) {
    console.error("Unexpected finish-run failure.", error);
    return json({ error: "Unexpected finish-run failure." }, { status: 500 });
  }
});
