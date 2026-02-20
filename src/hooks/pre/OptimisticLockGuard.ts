/**
 * pre/OptimisticLockGuard.ts
 * ─────────────────────────────────────────────────────────────
 * PRE-HOOK #4 — The Optimistic Lock Guard
 *
 * Prevents parallel agent sessions from overwriting each other's
 * work by detecting stale reads.
 *
 * If the agent passes a read_hash parameter with a write tool,
 * this hook verifies the hash matches the current file on disk.
 * A mismatch means another agent wrote to the file after this
 * agent last read it — the write is blocked.
 *
 * Also captures __oldContent__ for the mutation classifier.
 * ─────────────────────────────────────────────────────────────
 */

import * as fs from "fs"
import * as path from "path"
import * as crypto from "crypto"
import { ToolContext, BlockSignal } from "../HookEngine"

/** Tools that carry a target file path for write operations */
const WRITE_TOOLS = new Set([
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
])

const PATH_PARAMS = ["path", "file_path", "target_file", "destination"]

export async function optimisticLockGuard(ctx: ToolContext): Promise<ToolContext | BlockSignal> {
	// Only applies to write tools
	if (!WRITE_TOOLS.has(ctx.toolName)) return ctx

	const targetPath = extractTargetPath(ctx)
	if (!targetPath) return ctx

	const absolutePath = path.isAbsolute(targetPath) ? targetPath : path.join(ctx.workspacePath, targetPath)

	// File doesn't exist yet — new file creation, no stale check needed
	if (!fs.existsSync(absolutePath)) return ctx

	// Capture current content for mutation classifier (always)
	let currentContent: string
	try {
		currentContent = fs.readFileSync(absolutePath, "utf8")
	} catch {
		// Can't read — don't block, just skip
		return ctx
	}

	// Compute current hash for comparison
	const currentHash = "raw-sha256:" + crypto.createHash("sha256").update(currentContent).digest("hex")

	// Build enriched context with old content captured
	const enriched: ToolContext = {
		...ctx,
		__oldContent__: currentContent,
	}

	// If the agent passed a read_hash, validate it
	const readHash = ctx.params["read_hash"] as string | undefined
	if (readHash && typeof readHash === "string") {
		if (readHash !== currentHash) {
			const relativePath = path.relative(ctx.workspacePath, absolutePath).replace(/\\/g, "/")
			return new BlockSignal(
				`BLOCKED [STALE_FILE]: "${relativePath}" was modified after you last read it.\n\n` +
					`Your read_hash: ${readHash}\n` +
					`Current hash:   ${currentHash}\n\n` +
					`Another agent or human edited this file. You must:\n` +
					`  1. Re-read the file with read_file("${relativePath}")\n` +
					`  2. Incorporate any changes from the current version\n` +
					`  3. Retry your write with the new read_hash: "${currentHash}"`,
				"STALE_FILE",
			)
		}
	}

	return enriched
}

// ── Helpers ────────────────────────────────────────────────────

function extractTargetPath(ctx: ToolContext): string | null {
	for (const param of PATH_PARAMS) {
		const val = ctx.params[param]
		if (typeof val === "string" && val.length > 0) return val
	}
	return null
}
