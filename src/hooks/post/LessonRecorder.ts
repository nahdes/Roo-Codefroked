/**
 * post/LessonRecorder.ts
 * ─────────────────────────────────────────────────────────────
 * POST-HOOK #3 — The Lesson Recorder
 *
 * Appends lessons to CLAUDE.md when significant events occur:
 *   - INTENT_EVOLUTION: API surface changed
 *   - SCOPE_VIOLATION: agent tried to write outside scope (blocked)
 *
 * CLAUDE.md is the shared brain across all parallel agent sessions.
 * Errors are swallowed — never crashes the agent turn.
 * ─────────────────────────────────────────────────────────────
 */

import * as fs from "fs"
import * as path from "path"
import { ToolContext } from "../HookEngine"

const CLAUDE_MD = "CLAUDE.md"

export async function lessonRecorder(ctx: ToolContext): Promise<ToolContext> {
	// Only record on INTENT_EVOLUTION mutations (significant API changes)
	if (ctx.mutationClass !== "INTENT_EVOLUTION") return ctx
	if (!ctx.intentId) return ctx

	try {
		const targetPath = extractTargetPath(ctx)
		if (!targetPath) return ctx

		const absolutePath = path.isAbsolute(targetPath) ? targetPath : path.join(ctx.workspacePath, targetPath)
		const relativePath = path.relative(ctx.workspacePath, absolutePath).replace(/\\/g, "/")

		const lesson = buildLesson(ctx, relativePath)
		appendToCLAUDEMd(ctx.workspacePath, lesson)
	} catch (err) {
		console.error("[LessonRecorder] Failed to record lesson:", err)
	}

	return ctx
}

// ── Lesson builder ─────────────────────────────────────────────

function buildLesson(ctx: ToolContext, relativePath: string): string {
	const timestamp = new Date().toISOString().slice(0, 16) + " UTC"
	return [
		`### [${timestamp}] INTENT_EVOLUTION — ${ctx.intentId}`,
		``,
		`**File:** \`${relativePath}\``,
		`**Tool:** \`${ctx.toolName}\``,
		`**Mutation:** API surface changed (exported symbols added, removed, or modified)`,
		``,
		`> Review the exported interface changes in \`${relativePath}\` before proceeding.`,
		`> Downstream consumers may need to be updated.`,
		``,
		`---`,
		``,
	].join("\n")
}

function appendToCLAUDEMd(workspacePath: string, lesson: string): void {
	const claudePath = path.join(workspacePath, CLAUDE_MD)

	if (!fs.existsSync(claudePath)) {
		// Bootstrap CLAUDE.md if it doesn't exist
		const header = [
			"# CLAUDE.md — Shared Agent Brain",
			"",
			"> Auto-maintained by the LessonRecorder post-hook.",
			"> Read this file at the start of every session to understand what has changed.",
			"",
			"## Lessons Learned",
			"",
		].join("\n")
		fs.writeFileSync(claudePath, header, "utf8")
	}

	fs.appendFileSync(claudePath, lesson, "utf8")
}

const PATH_PARAMS = ["path", "file_path", "target_file", "destination"]

function extractTargetPath(ctx: ToolContext): string | null {
	for (const param of PATH_PARAMS) {
		const val = ctx.params[param]
		if (typeof val === "string" && val.length > 0) return val
	}
	return null
}
