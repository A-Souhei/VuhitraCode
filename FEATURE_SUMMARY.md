# Feature: Analyse Agent & Data-Explore Subagent

## Overview

This feature introduces a new **Analyse Agent** for local data analysis with model locking and environment variable interpolation, along with a supporting **Data-Explore Subagent** for privacy-sensitive CSV analysis. Both agents run on local Ollama models and are designed to work with gitignored files securely.

## Branch

- **Branch**: `feat/analyse-agent`
- **Base**: `main`
- **Status**: Complete, ready for merge

## Commits Included

1. **e6ff203e9** - `feat: add analyse agent with model locking and env var interpolation`
2. **9757a4e11** - `feat: add data-explore subagent for sensitive CSV data analysis`
3. **ddc459cad** - `fix: add model_lock to secret agent for consistency`
4. **3384b4988** - `fix: audit findings in data-explore implementation`
5. **c4c1cfafc** - `fix: strengthen anti-hallucination requirements for analyse and data-explore agents`
6. **a991360f3** - `docs: add sequential chaining strategy for data-explore analysis`

## Key Features

### 1. Analyse Agent (`analyse.md`)

**Purpose**: Local data analyst running on Ollama for secure, offline data analysis

**Key Capabilities**:

- Runs locally on Ollama models (no cloud connectivity required)
- Analyzes gitignored files securely (bypasses gitignore checks like the secret agent)
- Direct file access without data sanitization
- Environment variable interpolation in agent frontmatter

**Configuration**:

- Located at: `.opencode/agent/analyse.md`
- Model locking enabled by default
- Supports `{env:VAR}` syntax in frontmatter for dynamic configuration

**Access Control**:

- Extended gitignore bypass in:
  - Session prompt setup
  - Read tool (fully bypasses gitignore, no faking)
- Used by Alice instructions for protected CSV file analysis

### 2. Data-Explore Subagent

**Purpose**: Specialized subagent for analyzing sensitive CSV data with privacy guarantees

**Key Characteristics**:

- Analyzes gitignored data locally on Ollama
- Returns **insights and patterns only**, never raw data values
- Privacy-preserving design for sensitive datasets
- Triggered by Alice for protected CSV files

**Implementation**:

- Integrated into prompt.ts and read.ts for gitignore bypass
- Anti-hallucination requirements enforced
- Sequential chaining strategy for multi-step analysis

### 3. Model Locking System

**Feature**: Prevents accidental model changes when an agent specifies a configured model

**Implementation**:

- UI Changes:
  - Model selector disabled in prompt-input when agent has locked model
  - Visual feedback for locked state
- CLI Changes:
  - `model.set()` blocked when model is locked
  - `model.cycle()` prevented when model is locked
  - `model.cycleFavorite()` prevented when model is locked
  - `model.list` command disabled in TUI when agent has locked model

- Applied to:
  - Analyse Agent (primary)
  - Secret Agent (for consistency)

### 4. Environment Variable Interpolation

**Feature**: Dynamic configuration using environment variables in agent frontmatter

**Syntax**: `{env:VARIABLE_NAME}` in markdown config frontmatter

**Use Cases**:

- Model specification: `model: {env:OLLAMA_MODEL}`
- API endpoints: `api_endpoint: {env:LOCAL_OLLAMA_URL}`
- Custom paths: `data_dir: {env:ANALYSIS_DATA_DIR}`

**Scope**: Analyse agent and all agents supporting dynamic configuration

## Breaking Changes

⚠️ **BREAKING CHANGE**: Model selection is now locked when an agent specifies a configured model. Users cannot override the model selector if the agent has a preconfigured model set.

## Files Modified/Created

### New Files

- `.opencode/agent/analyse.md` - Analyse agent configuration

### Modified Files

- `.opencode/` - Agent configuration system
- UI/prompt-input component - Model selector locking
- CLI model commands - Locking enforcement
- `prompt.ts` - Gitignore bypass for analyse and data-explore
- `read.ts` - Full gitignore bypass for analyse agent
- Alice agent instructions - Data-explore dispatching logic
- Agent security rules - Anti-hallucination requirements

## Testing & Validation

### Anti-Hallucination Requirements

- Both agents have strengthened requirements to prevent fabricated data
- Systematic validation before returning insights
- Data provenance tracking

### Sequential Chaining Strategy

- Multi-step analysis workflow documented
- Data-explore can decompose complex analyses into steps
- Each step validates before proceeding to next

### Audit Compliance

- All audit findings from implementation phase addressed
- Model locking prevents unintended agent behavior changes
- Gitignore bypass properly scoped and documented

## Integration Points

1. **Alice Agent**: Dispatches to data-explore for protected CSV analysis
2. **Session System**: Analyse agent benefits from model locking
3. **CLI**: Model commands respect locking constraints
4. **UI**: Prompt input respects model lock state
5. **Configuration System**: Environment variable interpolation

## Security Considerations

✓ **Gitignore Bypass**: Properly scoped to analyse and data-explore agents only
✓ **Local Processing**: No data leaves the system (local Ollama only)
✓ **Privacy Guarantees**: Data-explore returns insights, never raw values
✓ **Model Lock**: Prevents accidental model swaps that could expose different behavior
✓ **Anti-Hallucination**: Strengthened requirements prevent fabricated insights

## Deployment Notes

### Prerequisites

- Ollama running locally with configured model
- Environment variables set for model configuration
- Alice agent updated with data-explore dispatch logic

### Configuration Required

- Set `OLLAMA_MODEL` environment variable
- Optionally set `LOCAL_OLLAMA_URL` if non-default
- Data-explore CSV files in gitignored directories

### No Database Migrations

- No schema changes required
- Configuration is markdown-based
- UI changes are additive (locking only)

## Related Issues/PRs

- Audit findings addressed in commit 3384b4988
- Sequential chaining strategy documented in commit a991360f3
- Model lock consistency applied to secret agent in commit ddc459cad

## Rollback Plan

If needed:

1. Revert to commit before `e6ff203e9`
2. Remove model locking UI components
3. Remove analyse agent from agents directory
4. Restore original gitignore handling in prompt.ts and read.ts
5. Remove data-explore dispatch from Alice instructions

## Future Enhancements

- [ ] GPU acceleration for local Ollama models
- [ ] Streaming responses for large dataset analysis
- [ ] Caching of analysis results
- [ ] Custom analysis templates
- [ ] Integration with vector databases for semantic search
