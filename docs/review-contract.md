# Review Contract (Slothworld)

This document defines how AI performs code and PR validation within the Slothworld system.

---

# 🧠 Purpose

The review layer ensures that all changes:

- preserve TaskEngine authority
- respect architectural boundaries
- do not introduce lifecycle violations
- remain selector-driven in UI
- comply with Slothworld invariants

This is NOT a style review.
This is a **system integrity enforcement layer**.

---

# 🔍 Review Scope

Claude MUST evaluate:

1. Architecture compliance
2. Lifecycle integrity
3. Boundary enforcement
4. Selector correctness
5. UI contract adherence
6. Event taxonomy compliance

---

# 📦 Required Output Structure

Every review MUST follow this structure:

## 1. Summary
- What the change does
- Which system areas are affected

---

## 2. Violations (if any)

List all violations of Slothworld rules.

Each violation MUST include:
- Rule violated
- File/module
- Why it is a violation
- Severity: (CRITICAL / HIGH / MEDIUM / LOW)

---

## 3. Required Fixes

For each violation:
- concrete fix description
- affected modules
- expected outcome after fix

---

## 4. Architecture Compliance Check

Explicitly confirm:

- TaskEngine remains sole lifecycle authority
- No lifecycle mutation outside engine
- Workers do not mutate state
- Providers remain stateless
- ACK flow is preserved

---

## 5. UI & Selector Compliance (if applicable)

If UI or selectors are touched, verify:

- UI consumes selectors only
- No raw event access in UI
- No branching on `event.type` or `payload.status`
- deriveWorldState remains index-only
- selectors contain all semantic logic

---

## 6. Event Taxonomy Compliance

Verify:

- All emitted events exist in taxonomy
- No unknown event types
- Lifecycle vs system event separation is preserved
- System events do not affect lifecycle derivation

---

## 7. Final Verdict

Must be one of:

- ✅ APPROVED
- ⚠️ APPROVED WITH CHANGES
- ❌ REJECTED

---

# 🚫 Hard Constraints

Claude MUST NOT:
- rewrite entire implementations unless explicitly requested
- suggest architecture changes outside the scope of the PR
- mix review with planning (no GitHub issue generation here)
- ignore violations even if minor
- approve code that breaks core invariants

---

# ⚠️ Critical Violation Rules

The following MUST result in automatic ❌ REJECTED:

- lifecycle mutation outside TaskEngine
- UI interpreting raw events
- provider used outside worker context
- missing ACK flow
- unknown event types in execution path
- selector logic moved into UI

---

# 🧠 Review Philosophy

- Slothworld is a deterministic system
- correctness > convenience
- invariants are not negotiable
- architecture violations are treated as system failures

---

# ⚡ Enforcement Standard

If any invariant is violated:
- the change is considered unsafe
- approval MUST be denied

No exceptions.