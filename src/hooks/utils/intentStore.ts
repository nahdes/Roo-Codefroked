/**
 * utils/intentStore.ts
 * ─────────────────────────────────────────────────────────────
 * Read/write layer for .orchestration/active_intents.yaml.
 *
 * All functions are synchronous and re-read the file on every
 * call — intentional, so that human edits are picked up without
 * restarting the extension.
 *
 * Never cached. Never written to by agents directly.
 * The ContextInjector and ScopeEnforcer pre-hooks are the only
 * consumers.
 * ─────────────────────────────────────────────────────────────
 */

import * as fs from "fs"
import * as path from "path"
import * as yaml from "js-yaml"
import { minimatch } from "minimatch"

// ── Types ──────────────────────────────────────────────────────

export interface ActiveIntent {
	id: string
	name: string
	status: "PENDING" | "IN_PROGRESS" | "BLOCKED" | "COMPLETE"
	created_at: string
	updated_at: string
	owned_scope: string[]
	constraints: string[]
	acceptance_criteria: string[]
	depends_on: string[]
	contributors: Contributor[]
	blocked_reason?: string
}

export interface Contributor {
	entity_type: "AI" | "HUMAN"
	model_identifier?: string
	session_id?: string
	last_active?: string
}

interface IntentsFile {
	active_intents: ActiveIntent[]
}

// ── File path ──────────────────────────────────────────────────

function intentsFilePath(workspacePath: string): string {
	return path.join(workspacePath, ".orchestration", "active_intents.yaml")
}

// ── Core loaders ───────────────────────────────────────────────

/**
 * Load all intents from active_intents.yaml.
 * Returns empty array if the file does not exist.
 * Throws if the file exists but is malformed YAML.
 */
export function loadIntents(workspacePath: string): ActiveIntent[] {
	const filePath = intentsFilePath(workspacePath)

	if (!fs.existsSync(filePath)) {
		return []
	}

	try {
		const raw = fs.readFileSync(filePath, "utf8")
		const parsed = yaml.load(raw) as IntentsFile
		return parsed?.active_intents ?? []
	} catch (err) {
		console.error(`[intentStore] Failed to parse ${filePath}:`, err)
		throw new Error(
			`[intentStore] active_intents.yaml is malformed: ${err instanceof Error ? err.message : String(err)}`,
		)
	}
}

/**
 * Find a single intent by ID. Returns undefined if not found.
 */
export function findIntent(workspacePath: string, intentId: string): ActiveIntent | undefined {
	const intents = loadIntents(workspacePath)
	return intents.find((i) => i.id === intentId)
}

/**
 * Update the status of an intent in place.
 * Writes the updated YAML back to disk.
 */
export function updateIntentStatus(workspacePath: string, intentId: string, status: ActiveIntent["status"]): void {
	const filePath = intentsFilePath(workspacePath)
	const intents = loadIntents(workspacePath)

	const intent = intents.find((i) => i.id === intentId)
	if (!intent) {
		throw new Error(`[intentStore] Cannot update status: intent "${intentId}" not found`)
	}

	intent.status = status
	intent.updated_at = new Date().toISOString()

	const raw = fs.readFileSync(filePath, "utf8")

	// Preserve the file header comments by replacing only the data section
	const newYaml =
		"# ─────────────────────────────────────────────────────────────────────────────\n" +
		"# .orchestration/active_intents.yaml\n" +
		"# ─────────────────────────────────────────────────────────────────────────────\n\n" +
		yaml.dump({ active_intents: intents }, { lineWidth: 120, quotingType: '"' })

	fs.writeFileSync(filePath, newYaml, "utf8")
}

// ── Scope helpers ──────────────────────────────────────────────

/**
 * Returns true if the given absolute file path falls within
 * any of the intent's owned_scope glob patterns.
 *
 * All patterns are treated as relative to workspacePath.
 */
export function isFileInScope(workspacePath: string, intent: ActiveIntent, absoluteFilePath: string): boolean {
	// Normalise to a workspace-relative posix path
	const relative = path.relative(workspacePath, absoluteFilePath).replace(/\\/g, "/") // Windows → posix

	return intent.owned_scope.some((pattern) => minimatch(relative, pattern, { dot: true, matchBase: false }))
}

/**
 * Read .intentignore and return the list of exempt glob patterns.
 * Files matching these patterns bypass scope enforcement.
 */
export function loadIgnorePatterns(workspacePath: string): string[] {
	const ignorePath = path.join(workspacePath, ".intentignore")
	if (!fs.existsSync(ignorePath)) return []

	return fs
		.readFileSync(ignorePath, "utf8")
		.split("\n")
		.map((l) => l.trim())
		.filter((l) => l.length > 0 && !l.startsWith("#"))
}

/**
 * Returns true if the file is listed in .intentignore
 * (i.e., exempt from all scope enforcement).
 */
export function isFileIgnored(workspacePath: string, absoluteFilePath: string): boolean {
	const patterns = loadIgnorePatterns(workspacePath)
	if (patterns.length === 0) return false

	const relative = path.relative(workspacePath, absoluteFilePath).replace(/\\/g, "/")
	return patterns.some((pattern) => minimatch(relative, pattern, { dot: true }))
}
