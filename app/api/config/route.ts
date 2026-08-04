import { NextRequest, NextResponse } from "next/server";
import {
  DbConfig,
  Provider,
  SslMode,
  hostProblem,
  isPrivateHost,
  publicConfig,
  readConfig,
  testConfig,
  writeConfig,
} from "../../lib/db";
import { requireAdmin } from "../../lib/auth";

const PROVIDERS: Provider[] = ["sqlite", "mysql", "mariadb", "postgres"];
const SSL_MODES: SslMode[] = ["disable", "require", "verify"];

// Build a full DbConfig from a request body. The browser never receives the
// password or the SSL mode, so when it sends neither we carry the stored values
// forward — otherwise a "Test connection" on a pre-filled form would try a
// blank password, or guess the wrong TLS mode, and fail misleadingly.
function normalize(body: any): DbConfig {
  const provider = body?.provider as Provider;
  if (!PROVIDERS.includes(provider)) {
    throw new Error(`Unknown provider: ${provider}`);
  }
  if (provider === "sqlite") return { provider };

  const c = body.connection || {};
  if (!c.host || !c.database || !c.user) {
    throw new Error("Host, database, and user are required.");
  }

  const problem = hostProblem(String(c.host));
  if (problem) throw new Error(problem);

  // The stored config, but only when it describes the same target — otherwise
  // we would leak one database's password into a connection to another.
  const current = readConfig();
  const sameTarget =
    current.connection &&
    current.connection.host === c.host &&
    current.connection.database === c.database &&
    current.connection.user === c.user
      ? current.connection
      : null;

  const password =
    (typeof c.password === "string" && c.password) || sameTarget?.password || "";

  let ssl: SslMode;
  if (c.ssl !== undefined && c.ssl !== null && c.ssl !== "") {
    if (!SSL_MODES.includes(c.ssl)) {
      throw new Error(
        `Unknown SSL mode: ${c.ssl}. Expected ${SSL_MODES.join(", ")}.`
      );
    }
    ssl = c.ssl;
  } else if (sameTarget?.ssl) {
    ssl = sameTarget.ssl;
  } else {
    // Nothing to go on: public databases require TLS, one on a private
    // network has none. Same rule the env-var path uses — see isPrivateHost.
    ssl = isPrivateHost(String(c.host)) ? "disable" : "require";
  }

  return {
    provider,
    connection: {
      host: String(c.host),
      port: Number(c.port) || (provider === "postgres" ? 5432 : 3306),
      user: String(c.user),
      password,
      database: String(c.database),
      ssl,
    },
  };
}

// GET /api/config — current configuration (password redacted). Admin only:
// the connection details name internal hosts and users.
export async function GET(req: NextRequest) {
  try {
    const auth = await requireAdmin(req);
    if (auth.error) return auth.error;

    return NextResponse.json(publicConfig());
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// POST /api/config — test and save a configuration. Admin only.
// Body may include { test: true } to validate without persisting.
export async function POST(req: NextRequest) {
  try {
    const auth = await requireAdmin(req);
    if (auth.error) return auth.error;

    const body = await req.json();
    const config = normalize(body);

    // Always verify the connection before we commit to it.
    if (config.provider !== "sqlite") {
      await testConfig(config);
    }

    if (body.test) {
      return NextResponse.json({ ok: true });
    }

    writeConfig(config);
    return NextResponse.json({ ok: true, config: publicConfig(config) });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
