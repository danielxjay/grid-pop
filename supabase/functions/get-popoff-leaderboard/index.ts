import { createClient } from "npm:@supabase/supabase-js@2";

const PUZZLE_COUNT = 50;
const LEADERBOARD_LIMIT = 20;

// Padded target per puzzle: 8 + floor(index / 5), matching popoff-levels.js
function puzzleTarget(index: number): number {
  return 8 + Math.floor(index / 5);
}

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
    const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseServiceRoleKey) {
      return json({ error: "Supabase function secrets are missing." }, { status: 500 });
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey);

    const [progressResult, profilesResult] = await Promise.all([
      supabaseAdmin
        .from("popoff_progress")
        .select("user_id, best_by_puzzle"),
      supabaseAdmin
        .from("profiles")
        .select("id, display_name")
        .not("display_name", "is", null),
    ]);

    if (progressResult.error) {
      return json({ error: "Could not load leaderboard data." }, { status: 500 });
    }

    const profileMap = new Map<string, string>(
      (profilesResult.data ?? [])
        .filter((p) => p.display_name)
        .map((p) => [p.id, p.display_name as string])
    );

    const entries = (progressResult.data ?? [])
      .filter((row) => profileMap.has(row.user_id))
      .map((row) => {
        const bests: (number | null)[] = Array.isArray(row.best_by_puzzle)
          ? row.best_by_puzzle
          : [];

        let puzzlesCompleted = 0;
        let totalMoves = 0;
        let totalTarget = 0;

        for (let i = 0; i < Math.min(bests.length, PUZZLE_COUNT); i++) {
          const best = bests[i];
          if (typeof best === "number" && best > 0) {
            puzzlesCompleted++;
            totalMoves += best;
            totalTarget += puzzleTarget(i);
          }
        }

        return {
          displayName: profileMap.get(row.user_id)!,
          puzzlesCompleted,
          totalMoves,
          totalTarget,
          delta: totalMoves - totalTarget,
        };
      })
      .filter((e) => e.puzzlesCompleted > 0)
      .sort((a, b) => {
        if (b.puzzlesCompleted !== a.puzzlesCompleted) {
          return b.puzzlesCompleted - a.puzzlesCompleted;
        }
        return a.delta - b.delta;
      })
      .slice(0, LEADERBOARD_LIMIT)
      .map((e, i) => ({ ...e, rank: i + 1 }));

    return json(entries);
  } catch (err) {
    console.error("[get-popoff-leaderboard]", err);
    return json({ error: "Internal server error." }, { status: 500 });
  }
});
