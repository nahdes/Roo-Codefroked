/**
 * pre/IntentGatekeeper.ts
 * ─────────────────────────────────────────────────────────────
 * PRE-HOOK #1 — The Gatekeeper
 *
 * Blocks any destructive/mutating tool call that does not have
 * an active intent ID declared for the current session.
 *
 * The agent MUST call select_active_intent() before it can write
 * any files or execute any commands. This is the enforcement
 * mechanism for the Two-Stage State Machine.
 *
 * Safe (read-only) tools are allowed through unconditionally.
 * ─────────────────────────────────────────────────────────────
 */

import { ToolContext, BlockSignal } from "../HookEngine"

/** Tools that write to the filesystem or execute shell commands.
 *  Cross-referenced against every case in presentAssistantMessage.ts lines 678–918.
 *  ANY tool that calls checkpointSaveAndMark() or writes files is destructive.
 */
const DESTRUCTIVE_TOOLS = new Set([
	// File write tools
	"write_file",
	"write_to_file",
	"create_file",
	// Diff / patch tools
	"apply_diff",
	"apply_patch",
	// Edit tools (all mutate files — found in presentAssistantMessage.ts lines 702–726)
	"edit",
	"search_and_replace",
	"search_replace",
	"edit_file",
	// Legacy / other write tools
	"insert_code_block",
	"replace_in_file",
	"delete_file",
	// Shell execution
	"execute_command",
	"run_terminal_command",
	// Image generation writes to filesystem
	"generate_image",
])

/** Tools that are always allowed — they don't mutate state */
const SAFE_TOOLS = new Set([
	"read_file",
	"list_files",
	"list_directory",
	"search_files",
	"get_file_info",
	"codebase_search",
	"read_command_output",
	"select_active_intent", // the handshake tool itself — always allowed
	"attempt_completion",
	"ask_followup_question",
	"switch_mode",
	"use_mcp_tool",
	"access_mcp_resource",
	"run_slash_command",
	"skill",
	"update_todo_list",
	"new_task",
])

export async function intentGatekeeper(ctx: ToolContext): Promise<ToolContext | BlockSignal> {
	// Always allow safe tools — never block reads or meta-tools
	if (SAFE_TOOLS.has(ctx.toolName)) return ctx

	// Unknown tools pass through — we only gate tools we explicitly know are destructive
	if (!DESTRUCTIVE_TOOLS.has(ctx.toolName)) return ctx

	// Destructive tool without a declared intent → block
	if (!ctx.intentId) {
		return new BlockSignal(
			`BLOCKED [NO_INTENT_DECLARED]: You attempted to call "${ctx.toolName}" without first ` +
				`declaring an active intent.\n\n` +
				`You MUST call select_active_intent(intent_id) as your FIRST action this turn.\n` +
				`Valid intent IDs are listed in .orchestration/active_intents.yaml.\n\n` +
				`Example: select_active_intent({ "intent_id": "INT-001" })`,
			"NO_INTENT_DECLARED",
		)
	}

	return ctx
}
