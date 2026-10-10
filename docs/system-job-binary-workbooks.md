# SYSTEM binary workbook and Job-owned Python helpers

Shared platform support for Reasoning Jobs such as MTO. The Job owns the
engineering mapping; the SYSTEM lease owns runtime/result paths.

1. After job_runtime_prepare and drawing_job_result_location, acquire the
   detached lease using job_system_acquire(id=<canonical Job id>).
2. \`file_binary_read\`, \`file_binary_copy\`, \`file_binary_write\` accept
   **.xlsx only**, do not interpret binary workbook bytes as UTF-8, and
   require an active lease's tool_id. Read is capped at 1 MiB of binary
   content, write at 4 MiB; the helpers can handle larger workbooks without
   transporting base64 through ChatGPT.
3. Binary writes/copies use a same-directory staging file and hash guards.
   Create refuses overwriting an existing workbook; update requires the
   exact previous sha256. This does NOT validate spreadsheet formulas,
   formatting or column semantics; the Job helper must do so.
4. \`job_system_run_helper\` executes a hash-pinned .py file under the
   **current Job's** \`tools/**\` directory, not arbitrary Python code,
   shell commands or files from supplied project folders. The input is an
   explicit JSON manifest under \`<job-root>/runtime/**\`. There are no free
   argv/shell parameters. The controlled Python executable uses \`-I\`;
   the helper sees \`CADGPT_JOB_ROOT\`, \`CADGPT_JOB_RUNTIME_ROOT\` and
   \`CADGPT_JOB_RESULT_ROOT\` in a reduced environment. The output is
   stdout/stderr; the helper does not automatically generate an Excel file.
5. The helper source is **trusted Job code**; Python is not an OS sandbox.
   Review helpers before Job promotion, never execute snippets from PDFs,
   external folders or downloaded files, and never pass private credentials
   to helper input. Job authors must explicitly respect the returned
   runtime/result directories. No Job is granted general shell access.
6. The platform Python venv includes pinned \`openpyxl\`. Existing
   installations need to install the new pinned dependency, or rerun setup.
   Pulling/building alone does not install Python packages.
7. MTO must still validate all real template layouts, copy the exact
   template filename, preserve manual cells/formulas/formatting, validate
   the completed workbook on readback, and report BLOCKED if the helper or
   dependencies are missing. There is no implicit MTO registration/promotion.

Never put generated workbook bytes in permanent \`tools/templates\`;
those immutable templates are copied into the drawing-owned
\`jobs/<job-name>-result\` output directory.
