/**
 * pre/ScopeEnforcer.ts
 * ─────────────────────────────────────────────────────────────
 * PRE-HOOK #3 — The Scope Enforcer
 *
 * Blocks any write to a file that falls outside the active
 * intent's owned_scope glob patterns.
 *
 * Files listed in .intentignore are always exempt.
 * Safe (read-only) tools pass through unconditionally.
 * ─────────────────────────────────────────────────────────────
 */

import * as path from "path"
import { ToolContext, BlockSignal } from "../HookEngine"
import { findIntent, isFileInScope, isFileIgnored } from "../utils/intentStore"

/** Tool parameter names that carry the target file path */
const PATH_PARAMS = ["path", "file_path", "target_file", "destination"]

/** Tools that don't write files — always pass through */
const READ_ONLY_TOOLS = new Set([
	"read_file",
	"list_files",
	"list_directory",
	"search_files",
	"get_file_info",
	"select_active_intent",
	"attempt_completion",
	"ask_followup_question",
	"switch_mode",
	"codebase_search",
	"read_command_output",
	"use_mcp_tool",
	"access_mcp_resource",
	"new_task",
	"run_slash_command",
	"skill",
	"update_todo_list",
])

export async function scopeEnforcer(ctx: ToolContext): Promise<ToolContext | BlockSignal> {
	// Read-only tools — never scope-checked
	if (READ_ONLY_TOOLS.has(ctx.toolName)) return ctx

	// No intent declared — gatekeeper handles this case upstream
	if (!ctx.intentId) return ctx

	// Extract the target file path from tool params
	const targetPath = extractTargetPath(ctx)
	if (!targetPath) return ctx // Can't determine path — pass through

	// Resolve to absolute path
	const absolutePath = path.isAbsolute(targetPath) ? targetPath : path.join(ctx.workspacePath, targetPath)

	// .intentignore exempts files from all scope enforcement
	if (isFileIgnored(ctx.workspacePath, absolutePath)) {
		return ctx
	}

	// Load the active intent and check scope
	const intent = findIntent(ctx.workspacePath, ctx.intentId)
	if (!intent) {
		// Intent was declared but now missing — let gatekeeper handle this edge case
		return ctx
	}

	if (!isFileInScope(ctx.workspacePath, intent, absolutePath)) {
		const relativePath = path.relative(ctx.workspacePath, absolutePath).replace(/\\/g, "/")
		const scopeList = intent.owned_scope.map((s) => `  • ${s}`).join("\n")

		return new BlockSignal(
			`BLOCKED [SCOPE_VIOLATION]: "${relativePath}" is outside the scope of intent ${ctx.intentId} (${intent.name}).\n\n` +
				`Authorized scope for ${ctx.intentId}:\n${scopeList}\n\n` +
				`To write this file, either:\n` +
				`  1. Switch to an intent that owns "${relativePath}" via select_active_intent()\n` +
				`  2. Ask a human to add "${relativePath}" to ${ctx.intentId}'s owned_scope in active_intents.yaml\n` +
				`  3. Add the file to .intentignore if it is a shared config file`,
			"SCOPE_VIOLATION",
		)
	}

	return ctx
}

// ── Helpers ────────────────────────────────────────────────────

function extractTargetPath(ctx: ToolContext): string | null {
	for (const param of PATH_PARAMS) {
		const val = ctx.params[param]
		if (typeof val === "string" && val.length > 0) {
			return val
		}
	}
	return null
}
