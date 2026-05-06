import { createClient } from "npm:@supabase/supabase-js@2";
import {
  createCrunchGameState,
  crunchMovesMatchPrefix,
  parseCrunchMoves,
  replayCrunchRun,
} from "./run-logic.ts";

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

type ActiveCrunchRunRow = {
  id: string;
  tray_seed: string;
  wall_seed: string;
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

    const body = await req.json().catch(() => ({}));
    const probe = Boolean(body?.probe);
    const requestedRunId = typeof body?.runId === "string" ? body.runId : "";
    const requestedDeviceToken =
      typeof body?.deviceToken === "string" ? body.deviceToken : null;
    const requestedMoves = parseCrunchMoves(body?.moves);

    const { data: activeRuns, error: runError } = await supabaseAdmin
      .from("crunch_runs")
      .select("id, tray_seed, wall_seed, moves, device_token")
      .eq("user_id", authData.user.id)
      .eq("status", "active")
      .order("started_at", { ascending: false });

    if (runError) {
      return json({ error: "Could not load your active Crunch run." }, { status: 500 });
    }

    const runs = (activeRuns ?? []) as ActiveCrunchRunRow[];
    const run =
      (requestedRunId ? runs.find((entry) => entry.id === requestedRunId) : null) ??
      runs.find((entry) => getMoveCount(entry.moves) > 0) ??
      runs[0] ??
      null;

    if (!run) {
      return json({ error: "No active Crunch run found." }, { status: 404 });
    }

    const staleRunIds = runs.filter((entry) => entry.id !== run.id).map((entry) => entry.id);

    if (staleRunIds.length > 0 && !probe) {
      const { error: cleanupError } = await supabaseAdmin
        .from("crunch_runs")
        .update({ status: "abandoned", finished_at: new Date().toISOString() })
        .in("id", staleRunIds)
        .eq("status", "active");

      if (cleanupError) {
        return json({ error: "Could not load your active Crunch run." }, { status: 500 });
      }
    }

    const committedMoves = parseCrunchMoves(run.moves) ?? [];

    if (probe) {
      return json({
        runId: run.id,
        moveCount: committedMoves.length,
      });
    }

    let moves = committedMoves;

    if (requestedDeviceToken && run.device_token === requestedDeviceToken && requestedMoves) {
      if (crunchMovesMatchPrefix(committedMoves, requestedMoves)) {
        if (requestedMoves.length > committedMoves.length) {
          const replay = replayCrunchRun(run.tray_seed, run.wall_seed, requestedMoves, { requireGameOver: false });
          if (!replay.valid || !replay.game) {
            moves = committedMoves;
          } else {
            const { error: syncError } = await supabaseAdmin
              .from("crunch_runs")
              .update({ moves: requestedMoves })
              .eq("id", run.id)
              .eq("status", "active")
              .eq("device_token", requestedDeviceToken);

            if (syncError) {
              return json({ error: "Could not restore your saved Crunch run." }, { status: 500 });
            }

            moves = requestedMoves;
          }
        } else {
          moves = requestedMoves;
        }
      }
    }

    const replay = replayCrunchRun(run.tray_seed, run.wall_seed, moves, { requireGameOver: false });

    if (!replay.valid || !replay.game) {
      await supabaseAdmin
        .from("crunch_runs")
        .update({ status: "abandoned", finished_at: new Date().toISOString() })
        .eq("id", run.id)
        .eq("status", "active");

      return json({ error: "Your previous Crunch run could not be restored." }, { status: 409 });
    }

    const initialGame = createCrunchGameState(run.tray_seed, run.wall_seed);
    const keepDeviceToken = Boolean(requestedDeviceToken && run.device_token === requestedDeviceToken);
    const deviceToken = keepDeviceToken && requestedDeviceToken ? requestedDeviceToken : crypto.randomUUID();

    if (!keepDeviceToken) {
      const { data: claimedRun } = await supabaseAdmin
        .from("crunch_runs")
        .update({ device_token: deviceToken })
        .eq("id", run.id)
        .eq("status", "active")
        .select("id")
        .maybeSingle();

      if (!claimedRun) {
        return json({ error: "This Crunch run is no longer available." }, { status: 404 });
      }
    }

    return json({
      runId: run.id,
      deviceToken,
      initialBoard: initialGame.board,
      initialTray: initialGame.tray,
      initialWallDepth: initialGame.crunchWallDepth,
      initialNextWaveAtMs: initialGame.nextWaveAtMs,
      initialWallRngState: initialGame.wallRngState,
      initialTrayRngState: initialGame.trayRngState,
      moves,
      board: replay.game.board,
      tray: replay.game.tray,
      trayRngState: replay.game.trayRngState,
      wallDepth: replay.game.crunchWallDepth,
      nextWaveAtMs: replay.game.nextWaveAtMs,
      criticalUntilMs: replay.game.criticalUntilMs,
      wallRngState: replay.game.wallRngState,
      survivalMs: replay.survivalMs,
      poxelsPopped: replay.poxelsPopped,
      gameOver: replay.game.gameOver,
    });
  } catch (error) {
    console.error("Unexpected resume-crunch-run failure.", error);
    return json({ error: "Unexpected resume-crunch-run failure." }, { status: 500 });
  }
});
