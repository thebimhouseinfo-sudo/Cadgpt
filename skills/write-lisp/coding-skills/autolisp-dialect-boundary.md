# Coding Skill: AutoLISP Dialect Boundary

Purpose: prevent code generation from drifting into Common Lisp, Scheme, Clojure, or another Lisp-family dialect.

## Language identity

In CadGPT, `.lsp` means **AutoLISP / Visual LISP executed by AutoCAD**.

Do not treat AutoLISP as a subset of Common Lisp and do not fill gaps in AutoLISP syntax from general Lisp knowledge. When uncertain about a form or function, prefer an established pattern already present in `lisp/**` or Autodesk AutoLISP/Visual LISP semantics.

## AutoLISP function shape

Use AutoLISP `defun` argument/local syntax:

```lisp
(defun helper (arg1 arg2 / local1 local2)
  ...
)

(defun c:COMMAND (/ *error* ss i ent)
  ...
)
```

The slash `/` separates arguments from local variables. Do not use Common Lisp lambda-list keywords.

## Forms that must not be generated as AutoLISP

Unless a file explicitly defines a compatibility function with that exact name, do not generate Common Lisp forms such as:

```text
let / let*
flet / labels / macrolet
defmacro
defpackage / in-package
defclass / defgeneric / defmethod
loop / dolist / dotimes / do / do*
setf / psetf / incf / decf / push / pop
multiple-value-bind / multiple-value-setq
handler-case / unwind-protect
destructuring-bind
with-open-file / with-output-to-string
```

Do not use Common Lisp lambda-list keywords:

```text
&optional &rest &key &aux &body &whole &environment
```

Do not use Common Lisp reader shorthand such as `#'function` in generated AutoLISP. Use AutoLISP-compatible quoted symbols or `(function (lambda ...))` where required by the AutoLISP API.

## AutoLISP control and iteration

Prefer AutoLISP-native constructs already used throughout the TBH library:

- `if`, `cond`, `progn`
- `while`, `repeat`, `foreach`
- `setq`
- `lambda`, `function`, `mapcar`
- `ssget`, `ssname`, `sslength`, `ssdel`
- DXF functions such as `entget`, `entmod`, `entmake`, `entmakex`
- Visual LISP extensions such as `vl-sort`, `vl-remove`, `vl-catch-all-apply`
- ActiveX functions prefixed `vlax-` / `vla-` after `(vl-load-com)`

## Dialect verification gate

Every changed `.lsp` must pass `lisp_validate` before load. The harness treats recognizable Common Lisp-only forms and lambda-list keywords as dialect errors, not style warnings.

Passing static validation still does not prove runtime correctness; the file must then pass AutoCAD load/run/postcondition validation.