/**
 * DEFAULT_RAG_TEMPLATE from Open WebUI
 * Location: /backend/open_webui/config.py lines 3177-3201
 *
 * This is the PRIMARY GROUNDING MECHANISM that prevents hallucination
 * by explicitly instructing the model to only answer from provided context
 */

export const RAG_TEMPLATE = `You are a helpful assistant. When answering questions, please refer to the provided context.

If you don't know the answer, clearly state that you cannot determine it from the provided information.
If uncertain, ask the user for clarification.

Only include citations when you reference information from the provided context. 
Use the format [source_id] to cite sources (e.g., [1] refers to the first source).
Only include citations when the source tag has an id attribute.
Do not cite if the source tag does not contain an id attribute.

If the answer is not directly in the context but you have general knowledge about the topic, 
clearly explain to the user that this comes from your general knowledge, not the provided context.

---

CONTEXT:
{{CONTEXT}}

---

QUESTION:
{{QUERY}}

---

ANSWER:`

/**
 * Query generation template (Pattern 2 from Open WebUI)
 * Used to generate follow-up queries or reformulate user queries
 */
export const QUERY_GENERATION_TEMPLATE = `Given the following question and context, generate alternative queries or reformulations that might help find better answers.

ORIGINAL QUESTION:
{{QUERY}}

CONTEXT:
{{CONTEXT}}

Instructions:
- Err on the side of generating queries when uncertain
- Each query should be specific and answerable from the context
- Generate 3-5 alternative queries

ALTERNATIVE QUERIES:`

/**
 * MOA (Mixture of Agents) Synthesis Template (Pattern 3)
 * Used to critically evaluate and synthesize responses from multiple agents
 */
export const MOA_SYNTHESIS_TEMPLATE = `You are synthesizing responses from multiple AI agents. Your job is to critically evaluate them for accuracy, bias, and completeness.

QUESTION:
{{QUERY}}

CONTEXT:
{{CONTEXT}}

AGENT RESPONSES:
{{RESPONSES}}

Instructions:
- Identify which response is most factually accurate based on the context
- Note any hallucinations or unsupported claims
- Highlight any biases in the responses
- Synthesize the best parts into a single, grounded answer
- Cite sources for all claims

SYNTHESIS:`

/**
 * Code Interpreter Prompt (for data-explore agent)
 * Forces the model to generate executable code, not speculation
 */
export const CODE_INTERPRETER_TEMPLATE = `You are helping analyze data. Always generate executable code that produces actual results.

Instructions:
- Write complete, executable code
- Always print meaningful outputs
- Show your work and calculations explicitly
- Do not hallucinate results - only report what the code actually produces
- If the operation fails, report the error clearly

TASK:
{{TASK}}

DATA/CONTEXT:
{{CONTEXT}}

CODE TO EXECUTE:`

/**
 * System message that enforces anti-hallucination at the message level
 * Should be at position 0 in message array and never moved
 */
export const SYSTEM_MESSAGE_GROUNDING = `You are a factual, grounded assistant. Your role is to:

1. ONLY provide information that can be verified from provided context or your training data
2. When context is provided, prioritize it over general knowledge
3. Always distinguish between "stated in context" vs "my general knowledge"
4. If you don't know something, say "I cannot determine this from available information"
5. If uncertain, ask for clarification rather than speculate
6. Never make up data, statistics, or facts
7. Always cite sources when you reference provided context using [source_id] format
8. Refuse requests that would require hallucination or speculation beyond what's appropriate`

export default {
  RAG_TEMPLATE,
  QUERY_GENERATION_TEMPLATE,
  MOA_SYNTHESIS_TEMPLATE,
  CODE_INTERPRETER_TEMPLATE,
  SYSTEM_MESSAGE_GROUNDING,
}
