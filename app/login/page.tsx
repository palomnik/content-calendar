import { readFileSync } from "fs";
import { join } from "path";
import type { ReactNode } from "react";

import LoginForm from "./LoginForm";

// The welcome message is read from disk on every request so an operator can
// edit login_msg.md and see it without rebuilding.
export const dynamic = "force-dynamic";

const MESSAGE_PATH = join(process.cwd(), "login_msg.md");

/** Reject `javascript:` and friends — only links we would write ourselves. */
function safeHref(href: string): string | null {
  if (href.startsWith("/") || href.startsWith("#")) return href;
  if (/^(https?:|mailto:)/i.test(href)) return href;
  return null;
}

/** Inline markdown: links only. Everything else is emitted as plain text. */
function renderInline(text: string, key: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const link = /\[([^\]]+)\]\(([^)\s]+)\)/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = link.exec(text)) !== null) {
    if (match.index > cursor) nodes.push(text.slice(cursor, match.index));
    const href = safeHref(match[2]);
    const external = href !== null && /^https?:/i.test(href);
    nodes.push(
      href === null ? (
        match[1]
      ) : (
        <a
          key={`${key}-${match.index}`}
          href={href}
          target={external ? "_blank" : undefined}
          rel={external ? "noopener noreferrer" : undefined}
          className="font-medium text-[var(--accent)] underline underline-offset-2 transition hover:text-[var(--accent-hover)]"
        >
          {match[1]}
        </a>
      )
    );
    cursor = match.index + match[0].length;
  }

  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

/**
 * A deliberately small markdown subset — ATX headings, blank-line separated
 * paragraphs, and inline links. That is all login_msg.md needs, and it avoids
 * pulling a markdown parser in for one file.
 */
function renderMarkdown(source: string): ReactNode[] {
  return source
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block, i) => {
      const heading = /^(#{1,6})\s+(.*)$/.exec(block);
      if (heading) {
        // The page already owns the h1, so shift everything down one level.
        const Tag = `h${Math.min(heading[1].length + 1, 6)}` as "h2";
        return (
          <Tag
            key={i}
            className="mb-3 text-base font-semibold tracking-tight text-[var(--foreground)]"
          >
            {renderInline(heading[2], `h${i}`)}
          </Tag>
        );
      }

      return (
        <p key={i} className="mb-3 last:mb-0">
          {renderInline(block.replace(/\n/g, " "), `p${i}`)}
        </p>
      );
    });
}

/** Missing or empty message file simply means no message — never a 500. */
function loginMessage(): ReactNode {
  let source: string;
  try {
    source = readFileSync(MESSAGE_PATH, "utf8");
  } catch {
    return null;
  }

  const blocks = renderMarkdown(source);
  if (blocks.length === 0) return null;

  return (
    <div className="mb-8 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 text-sm leading-relaxed text-[var(--foreground)]">
      {blocks}
    </div>
  );
}

export default function LoginPage() {
  return <LoginForm message={loginMessage()} />;
}
