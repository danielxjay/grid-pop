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

type ActiveRunRow = {
  id: string;
  seed: string;
  moves: unknown;
  device_token: string | null;
};

function getMoveCount(rawMoves: unknown) {
  return Array.isArray(rawMoves) ? rawMoves.length : 0;
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
      global: { headers: { Authorization: authHeader } },
    });
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey);
    const { data: authData, error: authError } = await supabase.auth.getUser();

    if (authError || !authData.user) {
      console.error("Auth lookup failed.", authError);
      return json({ error: "Unauthorized." }, { status: 401 });
    }

    const { data: activeRuns, error: runError } = await supabaseAdmin
      .from("runs")
      .select("id, seed, moves, device_token")
      .eq("user_id", authData.user.id)
      .eq("status", "active")
      .order("started_at", { ascending: false });

    if (runError) {
      console.error("Run lookup failed.", runError);
      return json({ error: "Could not load your active run." }, { status: 500 });
    }

    const body = await req.json().catch(() => ({}));
    const requestedRunId = typeof body?.runId === "string" ? body.runId : "";
    const requestedDeviceToken =
      typeof body?.deviceToken === "string" ? body.deviceToken : null;
    const requestedMoves = parseMoves(body?.moves);

    const runs = (activeRuns ?? []) as ActiveRunRow[];
    const run =
      (requestedRunId ? runs.find((entry) => entry.id === requestedRunId) : null) ??
      runs.find((entry) => getMoveCount(entry.moves) > 0) ??
      runs[0] ??
      null;

    if (!run) {
      return json({ error: "No active run found." }, { status: 404 });
    }

    const staleRunIds = runs.filter((entry) => entry.id !== run.id).map((entry) => entry.id);

    if (staleRunIds.length > 0) {
      const { error: cleanupError } = await supabaseAdmin
        .from("runs")
        .update({ status: "abandoned", finished_at: new Date().toISOString() })
        .in("id", staleRunIds)
        .eq("status", "active");

      if (cleanupError) {
        console.error("Active run cleanup failed.", cleanupError);
        return json({ error: "Could not load your active run." }, { status: 500 });
      }
    }

    let moves = parseMoves(run.moves) ?? [];

    if (requestedDeviceToken && run.device_token === requestedDeviceToken) {
      if (requestedMoves) {
        if (movesMatchPrefix(moves, requestedMoves)) {
          if (requestedMoves.length > moves.length) {
            const { error: syncError } = await supabaseAdmin
              .from("runs")
              .update({ moves: requestedMoves })
              .eq("id", run.id)
              .eq("status", "active")
              .eq("device_token", requestedDeviceToken);

            if (syncError) {
              console.error("Same-device move sync failed.", syncError);
              return json({ error: "Could not restore your saved game." }, { status: 500 });
            }
          }

          moves = requestedMoves;
        } else if (!movesMatchPrefix(requestedMoves, moves)) {
          return json({ error: "Run state is out of sync. Reload to continue from the saved game." }, { status: 409 });
        }
      }
    }

    const replay = replayRun(run.seed, moves, { requireGameOver: false });

    if (!replay.valid || !replay.game) {
      // Corrupted run — abandon it so the client can start fresh
      await supabaseAdmin
        .from("runs")
        .update({ status: "abandoned", finished_at: new Date().toISOString() })
        .eq("id", run.id)
        .eq("status", "active");

      return json({ error: "Your previous game could not be restored." }, { status: 409 });
    }

    const game = replay.game;

    // If the game was already over (finish-run was never called), auto-submit the score
    if (game.gameOver) {
      const score = game.score ?? 0;

      const { data: claimedRun, error: claimError } = await supabaseAdmin
        .from("runs")
        .update({ status: "submitted", moves, finished_at: new Date().toISOString() })
        .eq("id", run.id)
        .eq("status", "active")
        .select("id")
        .maybeSingle();

      if (claimError) {
        console.error("Auto-submit claim failed.", claimError);
        return json({ error: "Could not save your finished game." }, { status: 500 });
      }

      if (!claimedRun) {
        const { data: existingScore, error: existingScoreError } = await supabaseAdmin
          .from("scores")
          .select("score")
          .eq("run_id", run.id)
          .maybeSingle();

        if (existingScoreError) {
          console.error("Existing score lookup failed.", existingScoreError);
          return json({ error: "Could not confirm your finished game." }, { status: 500 });
        }

        if (existingScore) {
          return json({ gameEnded: true, score: existingScore.score ?? score });
        }

        return json({ error: "This run is no longer available." }, { status: 409 });
      }

      const { error: scoreError } = await supabaseAdmin.from("scores").upsert({
        user_id: authData.user.id,
        run_id: run.id,
        score,
        best_combo: game.bestCombo,
        best_move_score: game.bestMoveScore,
        best_lines_cleared: game.bestLinesCleared,
        move_count: game.moveCount,
      }, {
        onConflict: "run_id",
      });

      if (scoreError) {
        console.error("Auto-submit score save failed.", scoreError);
        return json({ error: "Could not save your finished game." }, { status: 500 });
      }

      const { error: verifyError } = await supabaseAdmin
        .from("runs")
        .update({ status: "verified", verified_score: score, rejection_reason: null })
        .eq("id", run.id)
        .eq("status", "submitted");

      if (verifyError) {
        console.error("Auto-submit verification update failed.", verifyError);
      }

      return json({ gameEnded: true, score });
    }

    if (requestedDeviceToken && run.device_token === requestedDeviceToken) {
      return json({
        runId: run.id,
        deviceToken: requestedDeviceToken,
        board: game.board,
        tray: game.tray,
        score: game.score,
        bestScore: game.bestScore,
        combo: game.combo,
        moveCount: game.moveCount,
        bestCombo: game.bestCombo,
        bestMoveScore: game.bestMoveScore,
        bestLinesCleared: game.bestLinesCleared,
        moves,
      });
    }

    // Generate a new device token and atomically claim the run
    const deviceToken = crypto.randomUUID();
    const { data: claimedRun } = await supabaseAdmin
      .from("runs")
      .update({ device_token: deviceToken })
      .eq("id", run.id)
      .eq("status", "active")
      .select("id")
      .maybeSingle();

    if (!claimedRun) {
      return json({ error: "This run is no longer available." }, { status: 404 });
    }

    return json({
      runId: run.id,
      deviceToken,
      board: game.board,
      tray: game.tray,
      score: game.score,
      bestScore: game.bestScore,
      combo: game.combo,
      moveCount: game.moveCount,
      bestCombo: game.bestCombo,
      bestMoveScore: game.bestMoveScore,
      bestLinesCleared: game.bestLinesCleared,
      moves: run.moves ?? [],
    });
  } catch (error) {
    console.error("Unexpected resume-run failure.", error);
    return json({ error: "Unexpected resume-run failure." }, { status: 500 });
  }
});
