/**
 * hooks/index.ts
 * ─────────────────────────────────────────────────────────────
 * Entry point for the Intent-Driven Hook System.
 *
 * Exports:
 *   registerAllHooks(workspacePath)  — called once at extension activation
 *   dispatchWithHooks(...)           — drop-in wrapper for tool execution
 *   hookEngine                       — singleton for direct access if needed
 *
 * Wire-up in extension.ts:
 *   import { registerAllHooks } from "./hooks"
 *   registerAllHooks(workspacePath)
 *
 * Wire-up in presentAssistantMessage.ts:
 *   import { dispatchWithHooks, BlockSignal } from "./hooks"
 *   (see integration patch below)
 * ─────────────────────────────────────────────────────────────
 */

import { hookEngine, BlockSignal, ToolContext } from "./HookEngine"

// ── Pre-hooks ──────────────────────────────────────────────────
import { contextInjector } from "./pre/ContextInjector"
import { intentGatekeeper } from "./pre/IntentGatekeeper"
import { scopeEnforcer } from "./pre/ScopeEnforcer"
import { optimisticLockGuard } from "./pre/OptimisticLockGuard"

// ── Post-hooks ─────────────────────────────────────────────────
import { traceLogger } from "./post/TraceLogger"
import { intentMapUpdater } from "./post/IntentMapUpdater"
import { lessonRecorder } from "./post/LessonRecorder"

// Re-export for consumers
export { hookEngine, BlockSignal }
export type { ToolContext }

let _registered = false

/**
 * Register all hooks in the correct execution order.
 * Safe to call multiple times — subsequent calls are no-ops.
 *
 * Pre-hook order (matters — ContextInjector must run before Gatekeeper):
 *   1. ContextInjector    — intercepts select_active_intent, injects XML
 *   2. IntentGatekeeper   — blocks destructive tools without intent
 *   3. ScopeEnforcer      — blocks writes outside owned_scope
 *   4. OptimisticLockGuard — detects stale reads, captures old content
 *
 * Post-hook order (all run; errors swallowed):
 *   1. TraceLogger        — writes agent_trace.jsonl
 *   2. IntentMapUpdater   — updates intent_map.md
 *   3. LessonRecorder     — appends to CLAUDE.md on INTENT_EVOLUTION
 */
export function registerAllHooks(workspacePath: string): void {
	if (_registered) return
	_registered = true

	// Store workspacePath so hooks can access it without VS Code imports
	;(hookEngine as any)._workspacePath = workspacePath

	// Pre-hooks — ORDER MATTERS
	hookEngine.registerPre("ContextInjector", contextInjector)
	hookEngine.registerPre("IntentGatekeeper", intentGatekeeper)
	hookEngine.registerPre("ScopeEnforcer", scopeEnforcer)
	hookEngine.registerPre("OptimisticLockGuard", optimisticLockGuard)

	// Post-hooks
	hookEngine.registerPost("TraceLogger", traceLogger)
	hookEngine.registerPost("IntentMapUpdater", intentMapUpdater)
	hookEngine.registerPost("LessonRecorder", lessonRecorder)

	console.log("[HookEngine] All hooks registered. Workspace:", workspacePath)
}

// ── Result type for dispatchWithHooks ──────────────────────────

export interface HookDispatchResult {
	/** If set, return this to the LLM as the tool result (short-circuit or block) */
	interceptedContent?: string
	/** If true, the original tool was blocked and must NOT be executed */
	blocked: boolean
	/** The enriched context to use for post-hooks */
	ctx: ToolContext
}

/**
 * Run pre-hooks for a tool call and determine whether to proceed.
 *
 * Call this BEFORE executing the actual tool in presentAssistantMessage.ts.
 * After the tool runs, call runPostHooksForCtx() with the result context.
 *
 * @param toolName      The tool being called (e.g. "write_to_file")
 * @param params        Tool parameters from the LLM
 * @param workspacePath Absolute path to the workspace root
 * @returns HookDispatchResult — check .blocked before running the tool
 */
export async function runPreHooksForDispatch(
	toolName: string,
	params: Record<string, unknown>,
	workspacePath: string,
	sessionIntentId?: string,
): Promise<HookDispatchResult> {
	const ctx: ToolContext = {
		toolName,
		params,
		workspacePath,
		intentId: sessionIntentId,
	}

	const preResult = await hookEngine.runPreHooks(ctx)

	// Pre-hook blocked the tool
	if (preResult instanceof BlockSignal) {
		return {
			interceptedContent: `[HOOK BLOCKED ${preResult.code}]\n\n${preResult.reason}`,
			blocked: true,
			ctx,
		}
	}

	// ContextInjector short-circuit — return XML to LLM, skip real tool
	if (preResult.__injectedContext__) {
		return {
			interceptedContent: preResult.__injectedContext__,
			blocked: true, // tool should NOT execute
			ctx: preResult,
		}
	}

	return {
		blocked: false,
		ctx: preResult,
	}
}

/**
 * Run post-hooks after a tool has executed successfully.
 * Errors are swallowed internally — this never throws.
 */
export async function runPostHooksForCtx(ctx: ToolContext): Promise<void> {
	await hookEngine.runPostHooks(ctx)
}
