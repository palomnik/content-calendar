import { NextRequest, NextResponse } from "next/server";
import {
  DbConfig,
  Provider,
  publicConfig,
  readConfig,
  testConfig,
  writeConfig,
} from "../../lib/db";

const PROVIDERS: Provider[] = ["sqlite", "mysql", "mariadb", "postgres"];

// Build a full DbConfig from a request body, carrying forward the stored
// password when the client sends a blank one (it never receives the real one).
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

  let password = typeof c.password === "string" ? c.password : "";
  // Blank password + existing config for the same target → reuse stored one.
  if (!password) {
    const current = readConfig();
    if (
      current.connection &&
      current.connection.host === c.host &&
      current.connection.database === c.database &&
      current.connection.user === c.user
    ) {
      password = current.connection.password;
    }
  }

  return {
    provider,
    connection: {
      host: String(c.host),
      port: Number(c.port) || (provider === "postgres" ? 5432 : 3306),
      user: String(c.user),
      password,
      database: String(c.database),
    },
  };
}

// GET /api/config — current configuration (password redacted)
export async function GET() {
  try {
    return NextResponse.json(publicConfig());
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// POST /api/config — test and save a configuration.
// Body may include { test: true } to validate without persisting.
export async function POST(req: NextRequest) {
  try {
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
