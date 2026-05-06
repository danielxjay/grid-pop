import { createClient } from "npm:@supabase/supabase-js@2";

const BOARD_SIZE = 5;
const PUZZLE_COUNT = 55;
const MAX_MOVES = 500; // sanity ceiling — no legitimate solution needs this many

// Canonical puzzle starting states — mirrors GAME1 in src/popoff-levels.js
const PUZZLES: string[] = [
  "0000000100011100010000000",
  "1101110001000001000111011",
  "0111010101110111010101110",
  "0000010101101011010100000",
  "1010110001011101000110101",
  "0000000000101010000000000",
  "1010110101000001010110101",
  "0101011011110111101101010",
  "0000011011000001000111011",
  "1111011101111010001111011",
  "0000000000101011010101110",
  "1111010001100011000111110",
  "0000000100010101010101010",
  "0101011111011100101111100",
  "0111001110011100000000000",
  "1010110101101011010101110",
  "1111101010110110111001010",
  "0001000101010101010001000",
  "0000000000010000100001000",
  "0000001000000000100000000",
  "1000010000100001000011111",
  "0000000000001000111011111",
  "0010001010101010101000100",
  "1010100000101010000010101",
  "0000000000100010000000000",
  "0111101000011100100001000",
  "0111010001100011000101110",
  "0000000000001110011000100",
  "0000000000100011111101001",
  "1000011000111001111001111",
  "1000110001111111000110001",
  "0010001110001000010000100",
  "0000000000001110011100111",
  "0000001000000000000000000",
  "0000000000001000000000000",
  "1000111001101011001110001",
  "1111100010001000100011111",
  "0001000010101011000110011",
  "0010110001100010110101111",
  "0001101010100011010100000",
  "0010001010100011111110001",
  "0000001110011100111000000",
  "1010101010101010101010101",
  "0101010000110000011001010",
  "0000000000010100000000000",
  "1000101010001000010000100",
  "1110010010111001001011100",
  "1000111010111000100001110",
  "0000011011111110010001110",
  "0111010100001111111010101",
  "0010001110111110111000100",
  "0010011111101000100100001",
  "0000010001001001000100000",
  "1000101010001000101010001",
  "1111111111111111111111111",
];

function getAdjacentIndexes(index: number): number[] {
  const row = Math.floor(index / BOARD_SIZE);
  const col = index % BOARD_SIZE;
  return (
    [
      [0, 0],
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ] as [number, number][]
  )
    .map(([dr, dc]) => [row + dr, col + dc])
    .filter(([r, c]) => r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE)
    .map(([r, c]) => r * BOARD_SIZE + c);
}

function toggleAt(board: number[], index: number): number[] {
  const next = [...board];
  for (const i of getAdjacentIndexes(index)) {
    next[i] = next[i] === 1 ? 0 : 1;
  }
  return next;
}

function isSolved(board: number[]): boolean {
  return board.every((cell) => cell === 0);
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
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

    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
      return json({ error: "Server configuration error." }, { status: 500 });
    }

    // Authenticate the caller
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return json({ error: "Unauthorized." }, { status: 401 });
    }

    const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const {
      data: { user },
      error: authError,
    } = await supabaseUser.auth.getUser();

    if (authError || !user) {
      return json({ error: "Unauthorized." }, { status: 401 });
    }

    // Parse and validate request body
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return json({ error: "Invalid request body." }, { status: 400 });
    }

    const { puzzleIndex, moves } = body as {
      puzzleIndex: unknown;
      moves: unknown;
    };

    if (
      typeof puzzleIndex !== "number" ||
      !Number.isInteger(puzzleIndex) ||
      puzzleIndex < 0 ||
      puzzleIndex >= PUZZLE_COUNT
    ) {
      return json({ error: "Invalid puzzle index." }, { status: 400 });
    }

    if (
      !Array.isArray(moves) ||
      moves.length === 0 ||
      moves.length > MAX_MOVES
    ) {
      return json({ error: "Invalid moves." }, { status: 400 });
    }

    const allValid = (moves as unknown[]).every(
      (m) =>
        typeof m === "number" &&
        Number.isInteger(m) &&
        m >= 0 &&
        m < BOARD_SIZE * BOARD_SIZE
    );
    if (!allValid) {
      return json({ error: "Invalid move values." }, { status: 400 });
    }

    // Replay the submitted moves against the canonical starting board
    let board = PUZZLES[puzzleIndex].split("").map(Number);
    for (const move of moves as number[]) {
      board = toggleAt(board, move);
    }

    if (!isSolved(board)) {
      return json(
        { error: "Move sequence does not solve the puzzle." },
        { status: 400 }
      );
    }

    const moveCount = (moves as number[]).length;

    // Use service role to read and write — bypasses RLS intentionally
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey);

    const { data: existing } = await supabaseAdmin
      .from("popoff_progress")
      .select("best_by_puzzle")
      .eq("user_id", user.id)
      .maybeSingle();

    const currentBests: (number | null)[] = Array.isArray(
      existing?.best_by_puzzle
    )
      ? (existing.best_by_puzzle as (number | null)[])
      : [];

    // Ensure the array is long enough (also handles old 50-entry arrays from before the intro puzzles were added)
    while (currentBests.length < PUZZLE_COUNT) currentBests.push(null);

    const currentBest = currentBests[puzzleIndex];

    // Only write if this is a new solve or a better score
    if (currentBest !== null && currentBest <= moveCount) {
      return json({ best: currentBest, improved: false });
    }

    const updatedBests = [...currentBests];
    updatedBests[puzzleIndex] = moveCount;

    const { error: upsertError } = await supabaseAdmin
      .from("popoff_progress")
      .upsert(
        {
          user_id: user.id,
          best_by_puzzle: updatedBests,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      );

    if (upsertError) {
      console.error("[submit-popoff-solution] upsert error:", upsertError);
      return json({ error: "Failed to save progress." }, { status: 500 });
    }

    return json({ best: moveCount, improved: currentBest === null });
  } catch (err) {
    console.error("[submit-popoff-solution]", err);
    return json({ error: "Internal server error." }, { status: 500 });
  }
});
