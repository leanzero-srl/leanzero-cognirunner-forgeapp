<!-- NEGATIVE CONTROL. Ordinary field-guide prose. MUST produce no fatal finding. -->

# Sandbox traps

Never read step details from `functionsMeta` after an offload: the slim config keeps only
the id, the name, the operation type and the variable name. The offloaded bundle is the
source of truth.

A failed step must never look like success. `stepResults[].status` and the recommendation
are the contract, and simulation mode intercepts every write before it reaches Jira.

Untrusted content goes inside a fence and is defanged first, so it can never carry a
literal fence marker of its own.
