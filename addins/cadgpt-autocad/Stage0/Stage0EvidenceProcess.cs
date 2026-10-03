using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Runtime.Serialization;
using System.Runtime.Serialization.Json;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace CadGpt.AutoCad.Stage0
{
    [DataContract]
    internal sealed class Stage0UiObservation
    {
        [DataMember(Name = "success")]
        public bool Success { get; set; }

        [DataMember(Name = "method")]
        public string Method { get; set; } = string.Empty;

        [DataMember(Name = "adapter_version")]
        public string AdapterVersion { get; set; } = ChatNavigationScript.AdapterVersion;

        [DataMember(Name = "reference_hash")]
        public string ReferenceHash { get; set; } = string.Empty;

        [DataMember(Name = "failure_code")]
        public string FailureCode { get; set; } = string.Empty;

        [DataMember(Name = "manual_intervention")]
        public bool ManualIntervention { get; set; }

        [DataMember(Name = "started_at")]
        public string StartedAt { get; set; } = string.Empty;

        [DataMember(Name = "ended_at")]
        public string EndedAt { get; set; } = string.Empty;
    }

    internal sealed class Stage0EvidenceProcess
    {
        private readonly string _scriptPath;
        private readonly string _observationRoot;

        private Stage0EvidenceProcess(string scriptPath)
        {
            _scriptPath = scriptPath;
            _observationRoot = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "CadGPT",
                "runtime",
                "autocad-addin",
                "stage0-observations");
            Directory.CreateDirectory(_observationRoot);
        }

        public static Stage0EvidenceProcess? TryCreate()
        {
            var assemblyDir = Path.GetDirectoryName(
                Assembly.GetExecutingAssembly().Location);
            var cursor = assemblyDir == null ? null : new DirectoryInfo(assemblyDir);
            for (var depth = 0; cursor != null && depth < 10; depth += 1)
            {
                var candidate = Path.Combine(
                    cursor.FullName,
                    "scripts",
                    "stage0-evidence.mjs");
                if (File.Exists(candidate))
                {
                    return new Stage0EvidenceProcess(candidate);
                }

                cursor = cursor.Parent;
            }

            return null;
        }

        public Task<ProcessResult> StartRunAsync(
            string runId,
            CancellationToken token)
        {
            return RunAsync(
                "start --run " + Quote(runId),
                token,
                TimeSpan.FromSeconds(10));
        }

        public Task<ProcessResult> BeginAsync(
            string runId,
            string stepId,
            string caseName,
            int round,
            string chat,
            string expected,
            CancellationToken token)
        {
            var arguments =
                "begin --run " + Quote(runId) +
                " --step " + Quote(stepId) +
                " --case " + Quote(caseName) +
                " --round " + round +
                " --chat " + Quote(chat) +
                " --expect " + Quote(expected);
            return RunAsync(arguments, token, TimeSpan.FromSeconds(10));
        }

        public async Task<ProcessResult> EndAsync(
            string runId,
            string stepId,
            Stage0UiObservation observation,
            CancellationToken token)
        {
            var filePath = Path.Combine(
                _observationRoot,
                Sanitize(runId) + "-" + Sanitize(stepId) + ".json");
            WriteObservation(filePath, observation);
            return await RunAsync(
                "end --run " + Quote(runId) +
                " --step " + Quote(stepId) +
                " --ui-observation " + Quote(filePath),
                token,
                TimeSpan.FromSeconds(20));
        }

        private async Task<ProcessResult> RunAsync(
            string arguments,
            CancellationToken token,
            TimeSpan timeout)
        {
            token.ThrowIfCancellationRequested();
            var psi = new ProcessStartInfo
            {
                FileName = "node",
                Arguments = Quote(_scriptPath) + " " + arguments,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                WorkingDirectory = Path.GetDirectoryName(_scriptPath) ?? string.Empty
            };

            using (var process = new Process { StartInfo = psi })
            {
                if (!process.Start())
                {
                    return new ProcessResult(3, string.Empty, "NODE_START_FAILED");
                }

                var stdoutTask = process.StandardOutput.ReadToEndAsync();
                var stderrTask = process.StandardError.ReadToEndAsync();
                var exitTask = Task.Run(() =>
                {
                    process.WaitForExit();
                    return process.ExitCode;
                });

                var timeoutTask = Task.Delay(timeout, token);
                var completed = await Task.WhenAny(exitTask, timeoutTask);
                if (completed != exitTask)
                {
                    try { process.Kill(); } catch { }
                    token.ThrowIfCancellationRequested();
                    return new ProcessResult(5, string.Empty, "EVIDENCE_PROCESS_TIMEOUT");
                }

                return new ProcessResult(
                    await exitTask,
                    await stdoutTask,
                    await stderrTask);
            }
        }

        private static void WriteObservation(
            string filePath,
            Stage0UiObservation observation)
        {
            var serializer = new DataContractJsonSerializer(
                typeof(Stage0UiObservation));
            using (var stream = File.Create(filePath))
            {
                serializer.WriteObject(stream, observation);
            }
        }

        private static string Quote(string value)
        {
            return """ + value.Replace(""", "\"") + """;
        }

        private static string Sanitize(string value)
        {
            var builder = new StringBuilder(value.Length);
            foreach (var ch in value)
            {
                if (char.IsLetterOrDigit(ch) || ch == '-' || ch == '_' || ch == '.')
                {
                    builder.Append(ch);
                }
            }

            return builder.Length == 0 ? "stage0" : builder.ToString();
        }
    }

    internal sealed class ProcessResult
    {
        public ProcessResult(int exitCode, string standardOutput, string standardError)
        {
            ExitCode = exitCode;
            StandardOutput = standardOutput;
            StandardError = standardError;
        }

        public int ExitCode { get; }
        public string StandardOutput { get; }
        public string StandardError { get; }
        public bool Success => ExitCode == 0;
    }
}
