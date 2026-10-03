using System;
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
    internal sealed class AddinPairResponse
    {
        [DataMember(Name = "ok")]
        public bool Ok { get; set; }

        [DataMember(Name = "pair_id")]
        public string PairId { get; set; } = string.Empty;

        [DataMember(Name = "paired")]
        public bool Paired { get; set; }

        [DataMember(Name = "controller_ready")]
        public bool ControllerReady { get; set; }

        [DataMember(Name = "error")]
        public string Error { get; set; } = string.Empty;
    }

    [DataContract]
    internal sealed class AddinDrawingSummary
    {
        [DataMember(Name = "name")]
        public string? Name { get; set; }

        [DataMember(Name = "full_name")]
        public string? FullName { get; set; }
    }

    [DataContract]
    internal sealed class AddinConnectResponse
    {
        [DataMember(Name = "ok")]
        public bool Ok { get; set; }

        [DataMember(Name = "drawing")]
        public AddinDrawingSummary? Drawing { get; set; }

        [DataMember(Name = "cad_tools_ready")]
        public bool CadToolsReady { get; set; }

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
                // Pair persistence is convenience only; live pair still works.
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

        public Task<AddinPairResponse> StartPairAsync(
            CancellationToken token)
        {
            return SendAsync<AddinPairResponse>(
                "POST",
                "/addin-control/pair/start",
                null,
                token);
        }

        public Task<AddinPairResponse> GetPairStatusAsync(
            string pairId,
            CancellationToken token)
        {
            return SendAsync<AddinPairResponse>(
                "GET",
                "/addin-control/pair/" +
                Uri.EscapeDataString(pairId),
                null,
                token);
        }

        public Task<AddinConnectResponse> ConnectDrawingAsync(
            string pairId,
            string drawingSelector,
            CancellationToken token)
        {
            var body =
                "{\"pair_id\":" + JsonString(pairId) +
                ",\"drawing_selector\":" +
                JsonString(drawingSelector) +
                "}";

            return SendAsync<AddinConnectResponse>(
                "POST",
                "/addin-control/drawing/connect",
                body,
                token);
        }

        private async Task<T> SendAsync<T>(
            string method,
            string relativePath,
            string? body,
            CancellationToken token)
        {
            token.ThrowIfCancellationRequested();
            var descriptor = ReadDescriptor();
            var request = (HttpWebRequest)WebRequest.Create(
                "http://127.0.0.1:" +
                descriptor.Port +
                relativePath);
            request.Method = method;
            request.Timeout = 10000;
            request.ReadWriteTimeout = 10000;
            request.Headers["x-cadgpt-addin-secret"] =
                descriptor.Secret;
            request.Accept = "application/json";

            if (body != null)
            {
                var bytes = Encoding.UTF8.GetBytes(body);
                request.ContentType = "application/json";
                request.ContentLength = bytes.Length;
                using (var stream =
                    await request.GetRequestStreamAsync())
                {
                    token.ThrowIfCancellationRequested();
                    await stream.WriteAsync(
                        bytes,
                        0,
                        bytes.Length,
                        token);
                }
            }

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
                var response =
                    error.Response as HttpWebResponse;
                var message =
                    response == null
                        ? "ADDIN_CONTROL_UNAVAILABLE"
                        : ReadError(response);
                throw new AddinControlException(
                    message,
                    response?.StatusCode);
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
                        Deserialize<AddinPairResponse>(
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

        private static string JsonString(string value)
        {
            return "\"" +
                value
                    .Replace("\\", "\\\\")
                    .Replace("\"", "\\\"")
                    .Replace("\r", "\\r")
                    .Replace("\n", "\\n") +
                "\"";
        }
    }
}
