---
name: grill-me-code
description: 'Interview the user relentlessly about a coding plan or design until reaching shared understanding, resolving each branch of the decision tree. Use when the user wants to stress-test an implementation plan, get grilled on their technical design, or mentions "grill me" in a coding context.'
---

# Grill Me (Code)

Interview me relentlessly about every aspect of this plan until
we reach a shared understanding. Walk down each branch of the design
tree resolving dependencies between decisions one by one.

If a question can be answered by exploring the codebase, explore
the codebase instead of asking.

For each question, provide your recommended answer.

## When to Use

- The user wants to stress-test a coding plan, architecture, or design before implementation.
- The user explicitly says "grill me" about a technical decision.
- Requirements are vague and need to be discovered through discussion (rubber ducking).

## Output

After all branches of the decision tree are resolved, provide a concise summary of the shared understanding reached (decisions made, open questions resolved, and any remaining risks).
