import type OpenAI from "openai"

const SELECT_ACTIVE_INTENT_DESCRIPTION = `Declare the active business intent for this session before writing any files. This tool MUST be called as the FIRST action in any task that involves creating or modifying files. It validates the intent against .orchestration/active_intents.yaml and returns an <intent_context> XML block containing the owned_scope (file paths you are authorized to modify), constraints (rules you must follow), and acceptance_criteria (definition of done).

You MUST call this tool before using write_to_file, apply_diff, edit, edit_file, search_replace, execute_command, or any other file-writing tool. Attempting to write files without first calling select_active_intent will result in a BLOCKED error.

After receiving the <intent_context> response, read the owned_scope carefully — you may ONLY modify files within those paths. Writing to any file outside owned_scope will be blocked.

Example: Declaring intent to work on the weather API
{ "intent_id": "INT-001" }

Example: Declaring intent to work on the hook system
{ "intent_id": "INT-003" }`

const INTENT_ID_PARAMETER_DESCRIPTION = `The unique identifier of the intent to activate. Must exist in .orchestration/active_intents.yaml. Format: INT-XXX (e.g. INT-001, INT-002, INT-003). Check active_intents.yaml for the full list of valid IDs and their current status.`

export default {
	type: "function",
	function: {
		name: "select_active_intent",
		description: SELECT_ACTIVE_INTENT_DESCRIPTION,
		strict: true,
		parameters: {
			type: "object",
			properties: {
				intent_id: {
					type: "string",
					description: INTENT_ID_PARAMETER_DESCRIPTION,
				},
			},
			required: ["intent_id"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
