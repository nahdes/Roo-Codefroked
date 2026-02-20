/**
 * utils/astHasher.ts
 * ─────────────────────────────────────────────────────────────
 * AST-based content hashing for intent-code traceability.
 *
 * Hashes an AST structural fingerprint rather than raw file text,
 * achieving SPATIAL INDEPENDENCE: the same code structure produces
 * the same hash regardless of line number shifts or whitespace.
 *
 * Hash format:
 *   ast-sha256:<hex>   — AST fingerprint hash (TS/JS files)
 *   raw-sha256:<hex>   — Raw content hash (all other files)
 * ─────────────────────────────────────────────────────────────
 */

import * as crypto from "crypto"
import * as path from "path"

const TS_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs"])

export interface HashResult {
	hash: string
	method: "ast" | "raw"
	nodeCount: number
}

// ── AST Fingerprint Node ───────────────────────────────────────

interface FingerprintNode {
	type: string
	name?: string
	paramCount?: number
	exported?: boolean
	children: string[] // child node types only — no position info
}

// ── Main entry point ───────────────────────────────────────────

/**
 * Hash a code block using AST fingerprinting for TS/JS files,
 * falling back to raw SHA-256 for all other file types.
 */
export async function hashCodeBlock(content: string, filePath: string): Promise<HashResult> {
	const ext = path.extname(filePath).toLowerCase()

	if (TS_EXTENSIONS.has(ext)) {
		try {
			return await hashAst(content, filePath)
		} catch {
			// Parser unavailable or file unparseable — fall back gracefully
			return hashRaw(content)
		}
	}

	return hashRaw(content)
}

// ── AST hashing ────────────────────────────────────────────────

async function hashAst(content: string, filePath: string): Promise<HashResult> {
	// Dynamic import keeps the parser optional — if not installed the catch above handles it
	const { parse } = await import("@typescript-eslint/typescript-estree")

	const ast = parse(content, {
		jsx: filePath.endsWith(".tsx") || filePath.endsWith(".jsx"),
		loc: false, // no position info — spatial independence
		range: false,
		tokens: false,
		comment: false,
		errorOnUnknownASTType: false,
	})

	const fingerprints = extractFingerprints(ast.body)
	const fingerprintJson = JSON.stringify(fingerprints, null, 0)
	const hash = "ast-sha256:" + crypto.createHash("sha256").update(fingerprintJson).digest("hex")

	return { hash, method: "ast", nodeCount: fingerprints.length }
}

// ── Raw hashing ────────────────────────────────────────────────

function hashRaw(content: string): HashResult {
	const hash = "raw-sha256:" + crypto.createHash("sha256").update(content).digest("hex")
	return { hash, method: "raw", nodeCount: 0 }
}

// ── AST Fingerprint extractor ──────────────────────────────────

/**
 * Walk the top-level AST body and extract a structural fingerprint.
 * Only captures node type, name, param count, and export status.
 * No line numbers, no character offsets — pure structure.
 */
function extractFingerprints(body: any[]): FingerprintNode[] {
	const nodes: FingerprintNode[] = []

	for (const node of body) {
		switch (node.type) {
			case "FunctionDeclaration":
				nodes.push({
					type: "fn",
					name: node.id?.name,
					paramCount: node.params?.length ?? 0,
					exported: false,
					children: (node.body?.body ?? []).map((n: any) => n.type),
				})
				break

			case "ExportNamedDeclaration": {
				const decl = node.declaration
				if (!decl) {
					// export { foo, bar }
					for (const spec of node.specifiers ?? []) {
						nodes.push({ type: "export-ref", name: spec.exported?.name, children: [] })
					}
					break
				}
				if (decl.type === "FunctionDeclaration") {
					nodes.push({
						type: "fn",
						name: decl.id?.name,
						paramCount: decl.params?.length ?? 0,
						exported: true,
						children: (decl.body?.body ?? []).map((n: any) => n.type),
					})
				} else if (decl.type === "ClassDeclaration") {
					nodes.push({
						type: "class",
						name: decl.id?.name,
						exported: true,
						children: (decl.body?.body ?? []).map((n: any) => n.type),
					})
				} else if (decl.type === "TSInterfaceDeclaration") {
					nodes.push({
						type: "interface",
						name: decl.id?.name,
						exported: true,
						children: (decl.body?.body ?? []).map((n: any) => n.type),
					})
				} else if (decl.type === "TSTypeAliasDeclaration") {
					nodes.push({
						type: "type-alias",
						name: decl.id?.name,
						exported: true,
						children: [],
					})
				} else if (decl.type === "VariableDeclaration") {
					for (const v of decl.declarations ?? []) {
						nodes.push({
							type: "var",
							name: v.id?.name,
							exported: true,
							children: [v.init?.type ?? "unknown"],
						})
					}
				}
				break
			}

			case "ExportDefaultDeclaration":
				nodes.push({
					type: "export-default",
					name: node.declaration?.id?.name ?? node.declaration?.type,
					exported: true,
					children: [],
				})
				break

			case "ClassDeclaration":
				nodes.push({
					type: "class",
					name: node.id?.name,
					exported: false,
					children: (node.body?.body ?? []).map((n: any) => n.type),
				})
				break

			case "TSInterfaceDeclaration":
				nodes.push({
					type: "interface",
					name: node.id?.name,
					exported: false,
					children: (node.body?.body ?? []).map((n: any) => n.type),
				})
				break

			case "TSTypeAliasDeclaration":
				nodes.push({ type: "type-alias", name: node.id?.name, exported: false, children: [] })
				break

			case "VariableDeclaration":
				for (const v of node.declarations ?? []) {
					nodes.push({
						type: "var",
						name: v.id?.name,
						exported: false,
						children: [v.init?.type ?? "unknown"],
					})
				}
				break

			// Skip import declarations, comments, directives — not part of structural fingerprint
			default:
				break
		}
	}

	return nodes
}

// ── Exported API surface extractor ─────────────────────────────

export interface ExportSignature {
	kind: "fn" | "class" | "interface" | "type" | "var" | "ref" | "default"
	name: string
	paramCount?: number
}

/**
 * Extract the exported API surface from file content.
 * Used by mutationClassifier to determine AST_REFACTOR vs INTENT_EVOLUTION.
 */
export async function extractExports(content: string, filePath: string): Promise<ExportSignature[]> {
	const ext = path.extname(filePath).toLowerCase()
	if (!TS_EXTENSIONS.has(ext)) return []

	try {
		const { parse } = await import("@typescript-eslint/typescript-estree")
		const ast = parse(content, {
			jsx: filePath.endsWith(".tsx") || filePath.endsWith(".jsx"),
			loc: false,
			range: false,
			tokens: false,
			comment: false,
			errorOnUnknownASTType: false,
		})

		const exports: ExportSignature[] = []

		for (const node of ast.body) {
			if (node.type === "ExportNamedDeclaration") {
				const decl = (node as any).declaration
				if (!decl) {
					for (const spec of (node as any).specifiers ?? []) {
						exports.push({ kind: "ref", name: spec.exported?.name ?? "" })
					}
					continue
				}
				if (decl.type === "FunctionDeclaration") {
					exports.push({ kind: "fn", name: decl.id?.name ?? "", paramCount: decl.params?.length ?? 0 })
				} else if (decl.type === "ClassDeclaration") {
					exports.push({ kind: "class", name: decl.id?.name ?? "" })
				} else if (decl.type === "TSInterfaceDeclaration") {
					exports.push({ kind: "interface", name: decl.id?.name ?? "" })
				} else if (decl.type === "TSTypeAliasDeclaration") {
					exports.push({ kind: "type", name: decl.id?.name ?? "" })
				} else if (decl.type === "VariableDeclaration") {
					for (const v of decl.declarations ?? []) {
						exports.push({ kind: "var", name: v.id?.name ?? "" })
					}
				}
			} else if (node.type === "ExportDefaultDeclaration") {
				exports.push({
					kind: "default",
					name: (node as any).declaration?.id?.name ?? "__default__",
				})
			}
		}

		return exports
	} catch {
		return []
	}
}
