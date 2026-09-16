# write-lisp

`write-lisp` is CadGPT's specialized AutoLISP coding capability.

Its purpose is to safely inspect, create, patch, test, load, and verify AutoLISP required by Jobs.

The skill should use local file tools only within the allowed workspace roots, primarily `lisp/**`, and should validate changes with its coding harness before a Job relies on the result.

Detailed coding rules and harness implementation will be migrated/refined separately.
