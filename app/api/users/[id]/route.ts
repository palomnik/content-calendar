import { NextRequest, NextResponse } from "next/server";
import { hashPassword, passwordProblem, requireAdmin } from "../../../lib/auth";
import {
  countAdmins,
  deleteSessionsForUser,
  deleteUser,
  findUserById,
  Role,
  updateUser,
} from "../../../lib/db";

// PATCH /api/users/[id] — change a role, reset a password, or rename (admin).
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAdmin(req);
    if (auth.error) return auth.error;

    const { id } = await params;
    const target = await findUserById(id);
    if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const body = await req.json();
    const patch: { passwordHash?: string; role?: Role; displayName?: string | null } = {};

    if (body?.password !== undefined) {
      const problem = passwordProblem(body.password);
      if (problem) return NextResponse.json({ error: problem }, { status: 400 });
      patch.passwordHash = hashPassword(body.password);
    }

    if (body?.role !== undefined) {
      const role: Role = body.role === "admin" ? "admin" : "user";
      // Never let the last administrator demote themselves out of existence.
      if (target.role === "admin" && role !== "admin" && (await countAdmins()) <= 1) {
        return NextResponse.json(
          { error: "This is the only administrator. Promote someone else first." },
          { status: 400 }
        );
      }
      patch.role = role;
    }

    if (body?.displayName !== undefined) {
      patch.displayName =
        typeof body.displayName === "string" ? body.displayName.trim() || null : null;
    }

    const updated = await updateUser(id, patch);
    if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // An admin-forced password reset kicks that user off every device.
    if (patch.passwordHash) await deleteSessionsForUser(id);

    return NextResponse.json(updated);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}

// DELETE /api/users/[id] — remove an account (admin).
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAdmin(req);
    if (auth.error) return auth.error;

    const { id } = await params;

    if (id === auth.user.id) {
      return NextResponse.json(
        { error: "You cannot delete your own account." },
        { status: 400 }
      );
    }

    const target = await findUserById(id);
    if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 });

    if (target.role === "admin" && (await countAdmins()) <= 1) {
      return NextResponse.json(
        { error: "Cannot delete the only administrator." },
        { status: 400 }
      );
    }

    const ok = await deleteUser(id);
    if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });

    return NextResponse.json({ success: true, deleted: id });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
