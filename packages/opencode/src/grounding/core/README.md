# Core Anti-Hallucination Utilities

This folder contains the foundational classes and utilities for preventing Ollama hallucinations.

## Components

### 1. HallucinationGrounder (Main class)

Orchestrates all anti-hallucination techniques into a single, easy-to-use interface.

```typescript
import { HallucinationGrounder } from "./HallucinationGrounder"

const grounder = new HallucinationGrounder({
  temperature: 0.3,
  topP: 0.9,
  repeatPenalty: 1.1,
})

const grounded = grounder.groundPrompt(
  userQuery,
  dataContext, // { [sourceName]: content }
  systemPrompt,
)

const ollamaParams = grounder.getOllamaParams()
const check = grounder.checkForHallucinations(response, sourceCount)
```

**Methods**:

- `groundPrompt()` — Inject context and format prompt
- `getOllamaParams()` — Get model parameters for Ollama API
- `checkForHallucinations()` — Detect hallucinations in response
- `updateConfig()` — Change parameters at runtime
- `getConfig()` — Retrieve current configuration

---

### 2. SourceFormatter (XML source tagging)

Formats context with auto-numbered XML tags, enabling traceable citations.

```typescript
import { SourceFormatter } from "./SourceFormatter"

const sources = {
  "file.csv": "col1,col2\n10,20\n30,40",
  "analysis.txt": "The average is 25.",
}

const { xml, metadata } = SourceFormatter.format(sources)
// xml: '<source id="1" name="file.csv">...</source>\n<source id="2" name="analysis.txt">...</source>'

const citations = SourceFormatter.extractCitations("According to [1], the value is 10.")
// citations: [1]

const check = SourceFormatter.verifyCitations("According to [5], ...", 2)
// check: { valid: false, invalidCitations: [5] }
```

**Methods**:

- `format()` — Convert sources to XML with auto-numbered IDs
- `extractCitations()` — Find all [id] citations in text
- `verifyCitations()` — Verify citations refer to known sources

**Why it matters**: Forces the model to cite sources, making hallucinations verifiable or impossible.

---

### 3. PlaceholderGuard (UUID randomization)

Prevents prompt injection attacks by using globally unique placeholder IDs.

```typescript
import { PlaceholderGuard } from "./PlaceholderGuard"

const placeholder = PlaceholderGuard.createPlaceholder("QUERY")
// placeholder: '{{QUERY550e8400e29b41d4a716446655440000}}'

const template = "Answer: {{QUERY550e8400e29b41d4a716446655440000}}"
const final = PlaceholderGuard.safeReplace(template, {
  "{{QUERY550e8400e29b41d4a716446655440000}}": userInput,
})

// User input cannot contain the UUID, so injection is impossible
```

**Methods**:

- `createPlaceholder()` — Generate UUID-based placeholder
- `safeReplace()` — Replace placeholders safely
- `protectUserInput()` — Wrap user input in protected placeholder

**Why it matters**: User input cannot collide with template variables.

---

## Usage Examples

### Basic Usage

```typescript
import { HallucinationGrounder } from "./core"

const grounder = new HallucinationGrounder()

const dataContext = {
  "sales.csv": "2024-01,100\n2024-02,120\n2024-03,110",
  "summary.txt": "Q1 averaged 110 units",
}

const grounded = grounder.groundPrompt(
  "What was the Q1 average?",
  dataContext,
  "You are a data analyst. Answer only from provided context.",
)

console.log(grounded.final)
// Output: System prompt with context injected and grounded

const ollamaParams = grounder.getOllamaParams()
// Use in Ollama API call...

const check = grounder.checkForHallucinations(response, grounded.sources.length)
if (!check.passes) {
  console.error("Hallucinations detected:", check.issues)
}
```

### Advanced: Custom Parameters

```typescript
import { HallucinationGrounder } from "./core"
import { OLLAMA_DATA_EXPLORER } from "../params/ollama"

const grounder = new HallucinationGrounder(OLLAMA_DATA_EXPLORER)

// For very sensitive data, make it even stricter:
grounder.updateConfig({
  temperature: 0.1,
  repeatPenalty: 1.2,
})
```

### Advanced: Citation Verification

```typescript
import { SourceFormatter } from "./core"

const response = "According to [1], the value is 42. Reference: [2]."
const check = SourceFormatter.verifyCitations(response, 2)

if (!check.valid) {
  console.error(`Invalid citations: ${check.invalidCitations.join(", ")}`)
}
```

---

## Integration with Agents

### For Analyse Agent

```typescript
// In analyse agent handler
import { HallucinationGrounder } from "./grounding/core"
import { SYSTEM_MESSAGE_GROUNDING } from "./grounding/templates"

const grounder = new HallucinationGrounder()
const grounded = grounder.groundPrompt(
  task,
  codeContext, // Files being analyzed
  SYSTEM_MESSAGE_GROUNDING,
)

// Send to Ollama
const response = await ollama.generate({
  prompt: grounded.final,
  ...grounder.getOllamaParams(),
})

// Verify
const check = grounder.checkForHallucinations(response, grounded.sources.length)
```

### For Data-Explore Agent

```typescript
// In data-explore agent handler
import { HallucinationGrounder } from './grounding/core'
import { OLLAMA_DATA_EXPLORER } from './grounding/params/ollama'

const grounder = new HallucinationGrounder(OLLAMA_DATA_EXPLORER)
const grounded = grounder.groundPrompt(
  query,
  { 'data.csv': csvContent },
  'You are a data analyst...'
)

// Execute code + verify output
const codeResult = executeCode(...)
const verified = grounder.checkForHallucinations(codeResult, 1)
```

---

## Testing

Run tests with:

```bash
bun test grounding/core/
```

Tests cover:

- Citation extraction and verification
- Placeholder generation and collision avoidance
- Grounding prompt construction
- Hallucination detection
- Parameter application

---

## Performance

- **HallucinationGrounder**: <1ms overhead
- **SourceFormatter**: Linear with source count (negligible)
- **PlaceholderGuard**: UUID generation is <1ms
- **Overall**: No meaningful latency added

---

## Limitations

1. **Can't verify factuality of sources** — if context is wrong, model answers based on wrong data
2. **Citation patterns** — model might cite incorrectly if sources aren't clear
3. **Edge cases** — complex reasoning can still hallucinate despite grounding

## Future Improvements

- [ ] Semantic similarity check between citations and source
- [ ] Multi-language support for grounding prompts
- [ ] Model-specific parameter tuning
- [ ] Hallucination pattern learning/feedback loop
