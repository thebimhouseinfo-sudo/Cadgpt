# Coding Skill: Debugging and Testing

Purpose: debug AutoLISP from concrete AutoCAD evidence instead of repeatedly rewriting code.

## Debugging loop

Use this loop:

`reproduce → classify failure → inspect source/state → patch narrowly → static validate → reload → rerun → inspect drawing`

Do not rewrite an entire working command because one COM call or one mapping branch fails.

## Classify the failure first

Common classes:

- **reader/syntax**: unbalanced structure, malformed string, invalid symbol/form;
- **load**: file/path issue, undefined load-time dependency, host rejection;
- **command dispatch**: wrong `c:` name, wrong arguments, interactive prompt not satisfied;
- **selection**: filter matched zero or wrong entities;
- **DXF/type**: wrong group code or entity assumption;
- **COM**: invalid index, erased/proxy object, unsupported property, AutoCAD busy;
- **block structure**: reference changed but definition/internal entities did not;
- **drawing state**: locked/frozen layer, wrong current layer, wrong space, stale selection/object;
- **algorithm/data**: mapping/rule is wrong even though code runs.

Treat these differently. A COM `Invalid index` error is not a reason to change parentheses or rewrite selection logic.

## Reproduction evidence

Before patching runtime bugs, collect the smallest useful evidence:

- command name;
- target drawing identity;
- entity handle/type/layer when relevant;
- source file/function;
- actual error message;
- before-state counts/properties;
- expected state.

## Static test

Every edited `.lsp` must pass `lisp_validate` before load. Static validation catches source structure and command-contract problems; it does not prove CAD behavior.

## Load test

Load the exact edited file into the bound drawing with `cad__cad_load_lisp_file`.

A queued load is an intermediate gate only. If runtime evidence suggests the load did not complete, do not run the command blindly.

## Execution test

Prefer non-interactive commands with deterministic inputs. For interactive legacy commands, either use a defined automation path or restrict testing to load/static validation until safe invocation is available.

Do not rerun destructive commands after an uncertain transport failure unless post-inspection proves the first execution did not occur.

## Postcondition test

Use structured CAD inspection rather than visual assumption. Examples:

- entity count by layer/type;
- handle still exists or no longer exists;
- entity layer/color/linetype;
- block internal entity layers;
- attribute values;
- expected target layers created;
- unresolved source/review/detail entities remaining.

## Regression focus

For a patch to an existing LISP, verify both:

1. the reported defect is fixed;
2. the nearby command contract that previously worked is still intact.

AutoLISP regression testing should be proportional to the command and drawing mutation risk, not copied from application-level test suites.
