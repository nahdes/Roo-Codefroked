/**
 * post/TraceLogger.ts
 * ─────────────────────────────────────────────────────────────
 * POST-HOOK #1 — The Trace Logger
 *
 * Appends one entry to .orchestration/agent_trace.jsonl after
 * every successful file write tool call.
 *
 * Each entry records:
 *   - UUID, timestamp, git SHA
 *   - AST-based content hash (spatial independence)
 *   - Deterministic mutation class (computed, not agent-reported)
 *   - Link back to the active intent ID
 *
 * Errors are swallowed — a failing trace write must never crash
 * the agent turn (Constitution Article IV).
 * ─────────────────────────────────────────────────────────────
 */

import * as fs from "fs"
import * as path from "path"
import * as crypto from "crypto"
import { ToolContext } from "../HookEngine"
import { hashCodeBlock } from "../utils/astHasher"
import { classifyMutation } from "../utils/mutationClassifier"
import { getCurrentGitSha, toRelativePath } from "../utils/gitUtils"

const TRACE_FILE = ".orchestration/agent_trace.jsonl"

/** Tools that produce file mutations worth tracing */
const TRACED_TOOLS = new Set([
	"write_file",
	"write_to_file",
	"create_file",
	"apply_diff",
	"apply_patch",
	"edit",
	"search_and_replace",
	"search_replace",
	"edit_file",
	"insert_code_block",
	"replace_in_file",
	"delete_file",
])

const PATH_PARAMS = ["path", "file_path", "target_file", "destination"]

export async function traceLogger(ctx: ToolContext): Promise<ToolContext> {
	// Only trace write tools
	if (!TRACED_TOOLS.has(ctx.toolName)) return ctx

	const targetPath = extractTargetPath(ctx)
	if (!targetPath) return ctx

	const absolutePath = path.isAbsolute(targetPath) ? targetPath : path.join(ctx.workspacePath, targetPath)

	try {
		// Read the NEW content (after the write)
		let newContent = ""
		try {
			newContent = fs.readFileSync(absolutePath, "utf8")
		} catch {
			// File may have been deleted — still log the event
		}

		// Hash the new content
		const hashResult = await hashCodeBlock(newContent, absolutePath)

		// Classify the mutation (deterministic — not agent-reported)
		let mutationClass: string = ctx.mutationClass ?? "UNKNOWN"
		let classificationReason = "Classification skipped — no old content captured"

		if (ctx.__oldContent__ !== undefined) {
			const classification = await classifyMutation(ctx.__oldContent__, newContent, absolutePath)
			mutationClass = classification.mutationClass
			classificationReason = classification.reason
		}

		// Build trace entry
		const entry = {
			id: generateUuid(),
			timestamp: new Date().toISOString(),
			vcs: {
				revision_id: ctx.__gitSha__ ?? getCurrentGitSha(ctx.workspacePath),
			},
			mutation_class: mutationClass,
			classification_reason: classificationReason,
			files: [
				{
					relative_path: toRelativePath(ctx.workspacePath, absolutePath),
					conversations: [
						{
							session_id: (ctx as any).__sessionId__ ?? "unknown",
							contributor: {
								entity_type: "AI",
								model_identifier: (ctx as any).__modelId__ ?? "unknown",
							},
							ranges: [
								{
									start_line: 1,
									end_line: newContent.split("\n").length,
									content_hash: hashResult.hash,
									hash_method: hashResult.method,
									ast_node_count: hashResult.nodeCount,
								},
							],
							related: ctx.intentId ? [{ type: "intent", value: ctx.intentId }] : [],
						},
					],
				},
			],
		}

		// Append to JSONL — one line per entry, never overwrite
		const tracePath = path.join(ctx.workspacePath, TRACE_FILE)
		ensureDirectoryExists(path.dirname(tracePath))
		fs.appendFileSync(tracePath, JSON.stringify(entry) + "\n", "utf8")
	} catch (err) {
		// Post-hooks must never throw — swallow and log
		console.error("[TraceLogger] Failed to write trace entry:", err)
	}

	return ctx
}

// ── Helpers ────────────────────────────────────────────────────

function extractTargetPath(ctx: ToolContext): string | null {
	for (const param of PATH_PARAMS) {
		const val = ctx.params[param]
		if (typeof val === "string" && val.length > 0) return val
	}
	return null
}

function generateUuid(): string {
	// Use crypto.randomUUID() if available (Node 14.17+), else fallback
	if (typeof crypto.randomUUID === "function") {
		return crypto.randomUUID()
	}
	return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
		const r = (Math.random() * 16) | 0
		return (c === "x" ? r : (r & 0x3) | 0x8).toString(16)
	})
}

function ensureDirectoryExists(dirPath: string): void {
	if (!fs.existsSync(dirPath)) {
		fs.mkdirSync(dirPath, { recursive: true })
	}
}
