using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Runtime.Serialization;
using System.Runtime.Serialization.Json;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace CadGpt.AutoCad.Stage0
{
    [DataContract]
    internal sealed class AddinControlDescriptor
    {
        [DataMember(Name = "schema_version")]
        public int SchemaVersion { get; set; }

        [DataMember(Name = "port")]
        public int Port { get; set; }

        [DataMember(Name = "secret")]
        public string Secret { get; set; } = string.Empty;

        [DataMember(Name = "pid")]
        public int Pid { get; set; }
    }

    [DataContract]
    internal sealed class AddinDrawingSummary
    {
        [DataMember(Name = "name")]
        public string? Name { get; set; }

        [DataMember(Name = "full_name")]
        public string? FullName { get; set; }

        [DataMember(Name = "runtime_document_id")]
        public string? RuntimeDocumentId { get; set; }
    }

    [DataContract]
    internal sealed class AddinBackgroundJobSummary
    {
        [DataMember(Name = "job_id")]
        public string JobId { get; set; } = string.Empty;

        [DataMember(Name = "job_name")]
        public string JobName { get; set; } = string.Empty;
    }

    [DataContract]
    internal sealed class AddinReleaseResponse
    {
        [DataMember(Name = "ok")]
        public bool Ok { get; set; }

        [DataMember(Name = "pair_id")]
        public string PairId { get; set; } = string.Empty;

        [DataMember(Name = "released")]
        public bool Released { get; set; }
    }

    [DataContract]
    internal sealed class AddinBindingResponse
    {
        [DataMember(Name = "ok")]
        public bool Ok { get; set; }

        [DataMember(Name = "pair_id")]
        public string PairId { get; set; } = string.Empty;

        [DataMember(Name = "expires_at")]
        public string ExpiresAt { get; set; } = string.Empty;

        [DataMember(Name = "paired")]
        public bool Paired { get; set; }

        [DataMember(Name = "session_ready")]
        public bool SessionReady { get; set; }

        [DataMember(Name = "drawing")]
        public AddinDrawingSummary? Drawing { get; set; }

        [DataMember(Name = "bound_count")]
        public int BoundCount { get; set; }

        [DataMember(Name = "human_power")]
        public bool HumanPower { get; set; }

        [DataMember(Name = "background_jobs")]
        public List<AddinBackgroundJobSummary> BackgroundJobs { get; set; } =
            new List<AddinBackgroundJobSummary>();

        [DataMember(Name = "error")]
        public string Error { get; set; } = string.Empty;
    }

    internal sealed class AddinControlException : Exception
    {
        public AddinControlException(
            string message,
            HttpStatusCode? statusCode = null)
            : base(message)
        {
            StatusCode = statusCode;
        }

        public HttpStatusCode? StatusCode { get; }
    }

    internal sealed class AddinControlClient
    {
        private static string DescriptorPath =>
            Path.Combine(
                Environment.GetFolderPath(
                    Environment.SpecialFolder.LocalApplicationData),
                "CadGPT",
                "state",
                "addin-control.json");

        private static string PairPath =>
            Path.Combine(
                Environment.GetFolderPath(
                    Environment.SpecialFolder.LocalApplicationData),
                "CadGPT",
                "runtime",
                "autocad-addin",
                "pair-id.txt");

        public string? ReadSavedPairId()
        {
            try
            {
                if (!File.Exists(PairPath))
                {
                    return null;
                }

                var value = File.ReadAllText(PairPath).Trim();
                return string.IsNullOrWhiteSpace(value)
                    ? null
                    : value;
            }
            catch
            {
                return null;
            }
        }

        public void SavePairId(string pairId)
        {
            try
            {
                var directory = Path.GetDirectoryName(PairPath);
                if (!string.IsNullOrWhiteSpace(directory))
                {
                    Directory.CreateDirectory(directory);
                }

                File.WriteAllText(PairPath, pairId);
            }
            catch
            {
                // Pair persistence is convenience only.
            }
        }

        public void ClearSavedPairId()
        {
            try
            {
                if (File.Exists(PairPath))
                {
                    File.Delete(PairPath);
                }
            }
            catch
            {
            }
        }

        public Task<AddinBindingResponse> StartPairAsync(
            CancellationToken token)
        {
            return SendAsync<AddinBindingResponse>(
                "POST",
                "/addin-control/pair/start",
                token);
        }

        public Task<AddinBindingResponse> GetBindingStatusAsync(
            string pairId,
            CancellationToken token)
        {
            return SendAsync<AddinBindingResponse>(
                "GET",
                "/addin-control/binding/" +
                Uri.EscapeDataString(pairId),
                token);
        }

        public Task<AddinReleaseResponse> ReleasePairAsync(
            string pairId,
            CancellationToken token)
        {
            return SendAsync<AddinReleaseResponse>(
                "POST",
                "/addin-control/pair/release/" +
                Uri.EscapeDataString(pairId),
                token);
        }

        private async Task<T> SendAsync<T>(
            string method,
            string relativePath,
            CancellationToken token)
        {
            token.ThrowIfCancellationRequested();
            var descriptor = ReadDescriptor();
            var request = (HttpWebRequest)WebRequest.Create(
                "http://127.0.0.1:" +
                descriptor.Port +
                relativePath);
            request.Method = method;
            request.Timeout = 5000;
            request.ReadWriteTimeout = 5000;
            request.Headers["x-cadgpt-addin-secret"] =
                descriptor.Secret;
            request.Accept = "application/json";

            using (var timeoutCts =
                CancellationTokenSource.CreateLinkedTokenSource(
                    token))
            {
                timeoutCts.CancelAfter(
                    TimeSpan.FromSeconds(5));
                using (timeoutCts.Token.Register(
                    () =>
                    {
                        try
                        {
                            request.Abort();
                        }
                        catch
                        {
                        }
                    }))
                {
                    try
                    {
                        using (var response =
                            (HttpWebResponse)await request.GetResponseAsync())
                        using (var stream = response.GetResponseStream())
                        {
                            token.ThrowIfCancellationRequested();
                            if (stream == null)
                            {
                                throw new AddinControlException(
                                    "ADDIN_CONTROL_EMPTY_RESPONSE",
                                    response.StatusCode);
                            }

                            return Deserialize<T>(stream);
                        }
                    }
                    catch (WebException error)
                    {
                        if (token.IsCancellationRequested)
                        {
                            throw new OperationCanceledException(
                                token);
                        }

                        var response =
                            error.Response as HttpWebResponse;
                        var message =
                            timeoutCts.IsCancellationRequested
                                ? "ADDIN_CONTROL_TIMEOUT"
                                : response == null
                                    ? "ADDIN_CONTROL_UNAVAILABLE"
                                    : ReadError(response);
                        throw new AddinControlException(
                            message,
                            response?.StatusCode);
                    }
                }
            }
        }

        private static AddinControlDescriptor ReadDescriptor()
        {
            try
            {
                using (var stream =
                    File.OpenRead(DescriptorPath))
                {
                    var descriptor =
                        Deserialize<AddinControlDescriptor>(
                            stream);
                    if (descriptor.SchemaVersion != 1 ||
                        descriptor.Port <= 0 ||
                        string.IsNullOrWhiteSpace(
                            descriptor.Secret))
                    {
                        throw new InvalidDataException();
                    }

                    return descriptor;
                }
            }
            catch
            {
                throw new AddinControlException(
                    "ADDIN_CONTROL_UNAVAILABLE");
            }
        }

        private static string ReadError(
            HttpWebResponse response)
        {
            try
            {
                using (var stream =
                    response.GetResponseStream())
                {
                    if (stream == null)
                    {
                        return "ADDIN_CONTROL_ERROR";
                    }

                    var payload =
                        Deserialize<AddinBindingResponse>(
                            stream);
                    return string.IsNullOrWhiteSpace(
                        payload.Error)
                        ? "ADDIN_CONTROL_ERROR"
                        : payload.Error;
                }
            }
            catch
            {
                return "ADDIN_CONTROL_ERROR";
            }
        }

        private static T Deserialize<T>(Stream stream)
        {
            var serializer =
                new DataContractJsonSerializer(typeof(T));
            var value = serializer.ReadObject(stream);
            if (value is T typed)
            {
                return typed;
            }

            throw new InvalidDataException(
                "Invalid CadGPT add-in control response.");
        }
    }
}
