# Coding Skill: Debugging and Testing

Purpose: debug AutoLISP from concrete AutoCAD evidence and finish with a real load test, without silently choosing a live project drawing.

## Evidence and target selection

Use `lisp_validate` with exactly one of raw `source` or managed `path`, or the development checker `npm run test:lisp-syntax -- <file.lsp> --profile=cadgpt --expect=COMMAND`. These use the shared validator, not an ad-hoc parenthesis count. Static validation does not establish native success.

Use the task's authorized bound drawing. Clarify only when the target or test mutation is unresolved; do not ask for a separate drawing selection after every edit. If a user requested a disposable test drawing, try `drawing_create_test` and do not silently fall back to a live project when it fails.

Reproduce/inspect the relevant failure, patch narrowly with the owned source API, validate, then load/run the exact source through verified CAD tools and inspect the concrete postcondition. If native AutoCAD is unavailable, report the checks actually performed and leave native verification explicitly pending. No draft/checkout/promotion ceremony is required.

## Classify the failure first

Common classes:

- **dialect**: Common Lisp/Scheme syntax accidentally generated instead of AutoLISP;
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
- exact authorized bound drawing identity;
- entity handle/type/layer when relevant;
- source file/function;
- actual AutoCAD error message or load log tail;
- before-state counts/properties;
- expected state.

## Syntax/static test

Use the shared CadGPT validator to diagnose source before load; it does not introduce a separate authoring lifecycle.

Source/dev preflight:

```text
npm run test:lisp-syntax -- "<file.lsp>" --profile=cadgpt [--expect=COMMAND]
```

MCP validation:

```text
lisp_validate(source=<exact authored text>, profile="cadgpt")
```

Imported managed source may use `lisp_validate(profile="syntax")`.

These paths intentionally share one validation engine. Do not replace them with a hand-written one-off parser. Static validation catches source structure, AutoLISP dialect and command/header contract problems; it does not prove AutoCAD can load the file.

## Verified load test

Load the exact edited file into the authorized bound drawing with:

```text
cad__cad_load_lisp_file
```

The load tool must return:

```text
loaded: true
```

before command execution or handoff.

If it returns `loaded: false`, read `error` and `log_tail`, patch the source, run `lisp_validate` again, and reload into the same authorized drawing. Repeat until the file loads cleanly or a concrete external blocker is identified.

Do not treat `SendCommand` enqueue/queue success as load success.

## Interactive-command rule

Many useful AutoLISP commands require user input: object selection, point picking, keywords, numbers, file dialogs, or other command-line interaction.

For such commands:

1. complete static validation;
2. obtain the user-authorized drawing;
3. load successfully in that drawing;
4. stop automated execution unless there is a deterministic, explicitly-supported automation path;
5. tell the user the Lisp **loaded successfully** and ask them to run the named command manually in the approved drawing;
6. use the user's reported error/result for the next debug iteration if needed.

Do not invent clicks, points, selections or keyword responses merely to claim a test passed.

This is still a valid handoff state because many AutoLISP defects fail during load before any user interaction begins.

## Non-interactive execution test

When the command has deterministic arguments and does not require manual prompts, it may be invoked with `cad__cad_run_lisp_command` after verified load.

Do not rerun destructive commands after an uncertain transport failure unless post-inspection proves the first execution did not occur.

## Postcondition test

When automated execution is possible, use structured CAD inspection rather than visual assumption. Examples:

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

## Handoff states

Only these outcomes are acceptable:

### Automated test complete

- static validation passed;
- the user approved the actual test drawing;
- verified load passed;
- command ran safely;
- structured postcondition passed.

### User interaction required

- static validation passed;
- the user approved the actual test drawing;
- verified load passed;
- command requires manual interaction;
- user is explicitly asked to test the command in that drawing.

### Blocked

- load/runtime evidence identifies a blocker that cannot be resolved automatically;
- the blocker and untested portion are stated explicitly.

Never hand off a changed Lisp with an unverified load state.