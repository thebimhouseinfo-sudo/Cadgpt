# Coding Skill: Debugging and Testing

Purpose: debug AutoLISP from concrete AutoCAD evidence and finish with a real load test, without risking a live project drawing.

## Non-negotiable test rule

Every changed production `.lsp` must be loaded in AutoCAD before handoff.

Static validation is only a pre-load gate. A file is not considered fixed merely because parentheses balance or `lisp_validate` passes.

Default test target:

```text
new blank unsaved drawing created with drawing_create_test
```

Alternative test target:

```text
a drawing explicitly designated by the user for testing
```

Never choose an open project drawing as a test target merely because it is currently active or already bound. Do not run experimental Lisp against a project file unless the user explicitly names that drawing as the intended test environment.

## Test-environment selection

Before the load gate:

1. if the user explicitly supplied a test DWG, use `drawing_list` and `drawing_bind` to bind exactly that drawing;
2. otherwise call `drawing_create_test`, which creates a new blank unsaved DWG and binds the CadGPT session to it;
3. confirm `drawing_status` before loading;
4. keep the project drawing untouched.

A blank drawing is sufficient for syntax/load validation. Commands that require representative geometry may need a user-designated test DWG or deliberately-created disposable test entities in the blank drawing.

## Debugging loop

Use this loop:

```text
reproduce/inspect
→ classify failure
→ inspect source/state
→ patch narrowly
→ lisp_validate
→ safe test drawing
→ verified load
→ read load error evidence
→ patch/revalidate/reload until loaded=true
→ run command when safely automatable
→ inspect drawing postcondition
```

Do not rewrite an entire working command because one COM call or one mapping branch fails.

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
- exact test drawing identity;
- entity handle/type/layer when relevant;
- source file/function;
- actual AutoCAD error message or load log tail;
- before-state counts/properties;
- expected state.

## Static test

Every edited `.lsp` must pass `lisp_validate` before load. Static validation catches source structure, AutoLISP dialect and command/header contract problems; it does not prove AutoCAD can load the file.

## Verified load test

Load the exact edited file into the safe bound test drawing with:

```text
cad__cad_load_lisp_file
```

The load tool must return:

```text
loaded: true
```

before command execution or handoff.

If it returns `loaded: false`, read `error` and `log_tail`, patch the source, run `lisp_validate` again, and reload. Repeat until the file loads cleanly or a concrete external blocker is identified.

Do not treat `SendCommand` enqueue/queue success as load success.

## Interactive-command rule

Many useful AutoLISP commands require user input: object selection, point picking, keywords, numbers, file dialogs, or other command-line interaction.

For such commands:

1. complete static validation;
2. load successfully in the safe test drawing;
3. stop automated execution unless there is a deterministic, explicitly-supported automation path;
4. tell the user the Lisp **loaded successfully** and ask them to run the named command manually in the designated test drawing;
5. use the user's reported error/result for the next debug iteration if needed.

Do not invent clicks, points, selections or keyword responses merely to claim a test passed.

This is still a valid handoff state because a large class of AutoLISP defects fail during load before any user interaction begins.

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
- safe test drawing confirmed;
- verified load passed;
- command ran safely;
- structured postcondition passed.

### User interaction required

- static validation passed;
- safe test drawing confirmed;
- verified load passed;
- command requires manual interaction;
- user is explicitly asked to test the command in the designated test drawing.

### Blocked

- load/runtime evidence identifies a blocker that cannot be resolved automatically;
- the blocker and untested portion are stated explicitly.

Never hand off a changed Lisp with an unverified load state.