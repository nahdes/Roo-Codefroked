/**
 * utils/gitUtils.ts
 * ─────────────────────────────────────────────────────────────
 * Non-throwing git helpers for the Hook System.
 * All functions return null rather than throwing on failure.
 * ─────────────────────────────────────────────────────────────
 */

import { execSync } from "child_process"
import * as path from "path"

/**
 * Get the current HEAD git SHA in the given workspace.
 * Returns null if git is not available or the directory is not a repo.
 */
export function getCurrentGitSha(workspacePath: string): string | null {
	try {
		return execSync("git rev-parse HEAD", {
			cwd: workspacePath,
			encoding: "utf8",
			stdio: ["pipe", "pipe", "pipe"],
			timeout: 3000,
		}).trim()
	} catch {
		return null
	}
}

/**
 * Convert an absolute file path to a workspace-relative posix path.
 * Returns the original path if it cannot be made relative.
 */
export function toRelativePath(workspacePath: string, absolutePath: string): string {
	try {
		return path.relative(workspacePath, absolutePath).replace(/\\/g, "/")
	} catch {
		return absolutePath
	}
}

/**
 * Get the git-tracked SHA of a specific file at HEAD.
 * Returns null if the file is untracked or git is unavailable.
 */
export function getFileShaAtHead(workspacePath: string, relativePath: string): string | null {
	try {
		return (
			execSync(`git ls-files --format='%(objectname)' -- "${relativePath}"`, {
				cwd: workspacePath,
				encoding: "utf8",
				stdio: ["pipe", "pipe", "pipe"],
				timeout: 3000,
			}).trim() || null
		)
	} catch {
		return null
	}
}
