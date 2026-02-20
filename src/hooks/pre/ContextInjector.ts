/**
pre/ContextInjector.ts
─────────────────────────────────────────────────────────────
PRE-HOOK #1 — The Context Injector

Intercepts every call to select_active_intent, looks up the
declared intent in active_intents.yaml, and returns a structured
<intent_context> XML block as the tool result WITHOUT executing
the real tool.

The dispatchWithHooks() wrapper detects __injectedContext__ and
short-circuits — the agent never directly reads the YAML file.
─────────────────────────────────────────────────────────────
*/
import { ToolContext, BlockSignal } from "../HookEngine"
import { findIntent, loadIntents, ActiveIntent } from "../utils/intentStore"

export async function contextInjector(ctx: ToolContext): Promise<ToolContext | BlockSignal> {
	// Only intercept the handshake tool
	if (ctx.toolName !== "select_active_intent") return ctx

	const intentId = ctx.params["intent_id"] as string
	if (!intentId || typeof intentId !== "string") {
		return new BlockSignal(
			"select_active_intent requires an intent_id string parameter.\n" +
				'Example: select_active_intent({ "intent_id": "INT-001" })',
			"GENERIC_BLOCK",
		)
	}

	const intent = findIntent(ctx.workspacePath, intentId)
	if (!intent) {
		const available = loadIntents(ctx.workspacePath)
			.map((i) => `• ${i.id}: ${i.name} [${i.status}]`)
			.join("\n")
		return new BlockSignal(
			`BLOCKED [UNKNOWN_INTENT]: No active intent found with id "${intentId}".\n\n` +
				`Available intents:\n${available || "  (none — create .orchestration/active_intents.yaml first)"}`,
			"UNKNOWN_INTENT",
		)
	}

	// Block COMPLETE intents — no further work allowed
	if (intent.status === "COMPLETE") {
		return new BlockSignal(
			`BLOCKED [COMPLETE_INTENT]: Intent "${intentId}" (${intent.name}) is already COMPLETE.\n` +
				`Create a new intent or ask a human to reopen this one before proceeding.`,
			"COMPLETE_INTENT",
		)
	}

	// Block BLOCKED intents — dependency not met
	if (intent.status === "BLOCKED") {
		const reason = (intent as any).blocked_reason ?? "A dependency must be resolved first."
		return new BlockSignal(
			`BLOCKED [BLOCKED_INTENT]: Intent "${intentId}" (${intent.name}) is currently BLOCKED.\n` +
				`Reason: ${reason}\n` +
				`Resolve the blocking dependency before proceeding.`,
			"BLOCKED_INTENT",
		)
	}

	// Build the structured XML context block
	const contextXml = buildIntentContextXml(intent)

	// Return a NEW context object — never mutate the input (Constitution Article VII)
	return {
		...ctx,
		intentId,
		__injectedContext__: contextXml,
	}
}

// ── XML Builder ────────────────────────────────────────────────
function buildIntentContextXml(intent: ActiveIntent): string {
	const scopeList = intent.owned_scope.map((s) => `    <path>${escapeXml(s)}</path>`).join("\n")
	const constraintList = intent.constraints.map((c) => `    <rule>${escapeXml(c)}</rule>`).join("\n")
	const criteriaList = intent.acceptance_criteria.map((c) => `    <criterion>${escapeXml(c)}</criterion>`).join("\n")

	return `<intent_context>
  <id>${escapeXml(intent.id)}</id>
  <name>${escapeXml(intent.name)}</name>
  <status>${escapeXml(intent.status)}</status>
  <owned_scope>
${scopeList}
  </owned_scope>
  <constraints>
${constraintList}
  </constraints>
  <acceptance_criteria>
${criteriaList}
  </acceptance_criteria>
  <instructions>
    You are now operating under intent ${escapeXml(intent.id)}.
    You MAY ONLY modify files within the paths listed in owned_scope.
    You MUST respect ALL constraints listed above.
    Before completing, verify each acceptance criterion is satisfied.
    Every write_to_file / apply_diff / edit_file call MUST target a path in owned_scope.
  </instructions>
</intent_context>`
}

function escapeXml(str: string): string {
	return str
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;")
}
