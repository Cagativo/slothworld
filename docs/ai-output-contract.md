# AI Output Contract (Slothworld) — MACHINE-VERIFIABLE

This contract defines a STRICT machine-validatable output format.

Outputs MUST be valid JSON and MUST pass all validation rules below.

Any violation = INVALID OUTPUT.

---

# 0. OUTPUT FORMAT (HARD REQUIREMENT)

All outputs MUST be valid JSON matching:

{
  "summary": string,
  "issues": Issue[],
  "milestones": Milestone[],
  "architectureImpact": ArchitectureImpact,
  "uiSpec": UIOptional | null
}

No markdown, no prose, no extra keys allowed.

---

# 1. ISSUE SCHEMA

{
  "id": string,                 // regex: ^[A-Z]+-\d{3}$
  "title": string,
  "description": string,
  "affectedModules": string[],
  "dependencies": string[],
  "acceptanceCriteria": string[]
}

RULES:
- id MUST be unique
- id MUST match regex ^[A-Z]+-\d{3}$
- affectedModules.length >= 1
- acceptanceCriteria.length >= 1
- no empty strings allowed anywhere

---

# 2. MILESTONE SCHEMA

{
  "id": string,         // "M1", "M2", ...
  "name": string,
  "issues": string[],   // MUST reference Issue.id
  "deliveryCondition": string
}

RULES:
- all issue references MUST exist in issues[]
- milestones MUST be sorted by id ascending
- no duplicate issue references

---

# 3. ARCHITECTURE IMPACT SCHEMA

{
  "taskEngine": string,
  "workerBehavior": string,
  "selectorChanges": string,
  "eventTaxonomyImpact": string,
  "lifecycleSafety": string,
  "engineViolationRisk": "NONE" | "LOW" | "MEDIUM" | "HIGH"
}

RULES:
- all fields REQUIRED
- engineViolationRisk MUST match enum exactly

---

# 4. UI SPEC (OPTIONAL)

{
  "required": boolean,
  "changes": string[],
  "selectorDependency": string[]
}

RULES:
- if UI not affected → uiSpec MUST be null
- if UI affected → required MUST be true

---

# 5. MACHINE VALIDATION RULES (STRICT MODE)

## 5.1 STRUCTURE VALIDATION
FAIL if:
- missing any required top-level key
- extra keys exist
- wrong type for any field

---

## 5.2 ISSUE VALIDATION
FAIL if:
- duplicate issue.id
- invalid issue.id format
- missing acceptanceCriteria or empty array
- missing affectedModules or empty array

---

## 5.3 MILESTONE VALIDATION
FAIL if:
- milestone references unknown issue.id
- missing issues in any milestone
- orphan issues exist (not referenced by any milestone)

---

## 5.4 DETERMINISM RULE
- issues MUST be sorted by id ascending
- milestones MUST be sorted by id ascending
- arrays MUST NOT be randomly ordered

---

## 5.5 CROSS-REFERENCE RULE
- every selector referenced MUST exist in codebase OR be explicitly defined in issues
- every event referenced MUST exist in eventTaxonomy OR be declared in issues

---

## 5.6 FORBIDDEN OUTPUT (HARD FAIL)

Reject output if it contains ANY of:
- markdown headings
- prose outside JSON
- "analysis"
- "notes"
- "risk section"
- explanations outside architectureImpact
- duplicate sections

---

# 6. ENFORCEMENT MODEL

This contract is VALID ONLY IF:

✔ JSON parses successfully  
✔ schema matches exactly  
✔ all references resolve  
✔ deterministic ordering is satisfied  

If ANY condition fails → output is INVALID.

---

# 7. FAILURE BEHAVIOR

If invalid:

- output MUST be regenerated
- partial acceptance is forbidden
- no human interpretation allowed