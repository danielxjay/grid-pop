import { createClient } from "npm:@supabase/supabase-js@2";

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

    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("display_name")
      .eq("id", authData.user.id)
      .maybeSingle();

    if (profileError) {
      console.error("Profile lookup failed.", profileError);
      return json({ error: "Could not load your profile." }, { status: 500 });
    }

    if (!profile?.display_name) {
      return json({ error: "Set a display name before starting." }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const clientVersion =
      typeof body?.clientVersion === "string" ? body.clientVersion.slice(0, 64) : null;
    const seed = crypto.randomUUID();

    const { data: run, error: runError } = await supabaseAdmin
      .from("runs")
      .insert({
        user_id: authData.user.id,
        seed,
        status: "active",
        client_version: clientVersion,
      })
      .select("id, seed")
      .single();

    if (runError || !run) {
      console.error("Run creation failed.", runError);
      return json({ error: "Could not start the game right now." }, { status: 500 });
    }

    return json({
      runId: run.id,
      seed: run.seed,
    });
  } catch (error) {
    console.error("Unexpected start-run failure.", error);
    return json({ error: "Unexpected start-run failure." }, { status: 500 });
  }
});
