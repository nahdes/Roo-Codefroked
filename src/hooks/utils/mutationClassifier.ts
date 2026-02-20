/**
 * utils/mutationClassifier.ts
 * ─────────────────────────────────────────────────────────────
 * Deterministic mutation classifier.
 *
 * Compares the exported API surface of old vs new file content
 * and returns a machine-computed mutation class — NEVER relying
 * on agent self-reporting.
 *
 * Rules:
 *   Same exports (names + kinds + paramCounts) → AST_REFACTOR
 *   Any added, removed, or changed export       → INTENT_EVOLUTION
 *   Non-TS/JS file or parse failure             → UNKNOWN
 * ─────────────────────────────────────────────────────────────
 */

import { extractExports, ExportSignature } from "./astHasher"

export type MutationClass = "AST_REFACTOR" | "INTENT_EVOLUTION" | "UNKNOWN"

export interface ClassificationResult {
	mutationClass: MutationClass
	reason: string
	added: string[]
	removed: string[]
	changed: string[]
}

/**
 * Classify a mutation by comparing old and new file content.
 *
 * @param oldContent  File content BEFORE the write (from OptimisticLockGuard.__oldContent__)
 * @param newContent  File content AFTER the write
 * @param filePath    Absolute or workspace-relative path (used to detect file type)
 */
export async function classifyMutation(
	oldContent: string,
	newContent: string,
	filePath: string,
): Promise<ClassificationResult> {
	try {
		const [oldExports, newExports] = await Promise.all([
			extractExports(oldContent, filePath),
			extractExports(newContent, filePath),
		])

		// If we got no exports from either (non-TS file or parse error) return UNKNOWN
		if (oldExports.length === 0 && newExports.length === 0) {
			return {
				mutationClass: "UNKNOWN",
				reason: "Could not parse exports — non-TypeScript file or parse error",
				added: [],
				removed: [],
				changed: [],
			}
		}

		const oldMap = exportMap(oldExports)
		const newMap = exportMap(newExports)

		const added: string[] = []
		const removed: string[] = []
		const changed: string[] = []

		// Find added and changed exports
		for (const [key, newSig] of newMap.entries()) {
			if (!oldMap.has(key)) {
				added.push(formatSig(newSig))
			} else {
				const oldSig = oldMap.get(key)!
				if (sigChanged(oldSig, newSig)) {
					changed.push(`${formatSig(oldSig)} → ${formatSig(newSig)}`)
				}
			}
		}

		// Find removed exports
		for (const [key, oldSig] of oldMap.entries()) {
			if (!newMap.has(key)) {
				removed.push(formatSig(oldSig))
			}
		}

		if (added.length === 0 && removed.length === 0 && changed.length === 0) {
			return {
				mutationClass: "AST_REFACTOR",
				reason: "Exported API surface unchanged — internal refactor only",
				added: [],
				removed: [],
				changed: [],
			}
		}

		const parts: string[] = []
		if (added.length > 0) parts.push(`+${added.length} added: ${added.join(", ")}`)
		if (removed.length > 0) parts.push(`-${removed.length} removed: ${removed.join(", ")}`)
		if (changed.length > 0) parts.push(`~${changed.length} changed: ${changed.join(", ")}`)

		return {
			mutationClass: "INTENT_EVOLUTION",
			reason: `API surface changed: ${parts.join("; ")}`,
			added,
			removed,
			changed,
		}
	} catch (err) {
		return {
			mutationClass: "UNKNOWN",
			reason: `Classification error: ${err instanceof Error ? err.message : String(err)}`,
			added: [],
			removed: [],
			changed: [],
		}
	}
}

// ── Helpers ────────────────────────────────────────────────────

function exportKey(sig: ExportSignature): string {
	return `${sig.kind}:${sig.name}`
}

function exportMap(exports: ExportSignature[]): Map<string, ExportSignature> {
	const map = new Map<string, ExportSignature>()
	for (const sig of exports) {
		map.set(exportKey(sig), sig)
	}
	return map
}

function sigChanged(old: ExportSignature, next: ExportSignature): boolean {
	if (old.kind !== next.kind) return true
	if (old.kind === "fn" && old.paramCount !== next.paramCount) return true
	return false
}

function formatSig(sig: ExportSignature): string {
	if (sig.kind === "fn") return `fn:${sig.name}:${sig.paramCount ?? 0}`
	return `${sig.kind}:${sig.name}`
}
