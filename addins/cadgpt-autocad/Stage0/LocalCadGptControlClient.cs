using System;
using System.IO;
using System.Net.Http;
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

        [DataMember(Name = "host")]
        public string Host { get; set; } = string.Empty;

        [DataMember(Name = "port")]
        public int Port { get; set; }

        [DataMember(Name = "token")]
        public string Token { get; set; } = string.Empty;
    }

    [DataContract]
    internal sealed class AddinControlResponse
    {
        [DataMember(Name = "ok")]
        public bool Ok { get; set; }

        [DataMember(Name = "paired")]
        public bool Paired { get; set; }

        [DataMember(Name = "error")]
        public string? Error { get; set; }

        [DataMember(Name = "drawing_name")]
        public string? DrawingName { get; set; }

        [DataMember(Name = "drawing_full_name")]
        public string? DrawingFullName { get; set; }

        [DataMember(Name = "cad_tools_ready")]
        public bool CadToolsReady { get; set; }
    }

    internal sealed class LocalCadGptControlClient
    {
        private static readonly HttpClient Http = new HttpClient(
            new HttpClientHandler { UseProxy = false });

        private static string DescriptorPath
        {
            get
            {
                var local = Environment.GetFolderPath(
                    Environment.SpecialFolder.LocalApplicationData);
                return Path.Combine(
                    local,
                    "CadGPT",
                    "runtime",
                    "autocad-addin",
                    "control.json");
            }
        }

        public async Task BeginPairAsync(
            string panelId,
            CancellationToken token)
        {
            var response = await SendAsync(
                HttpMethod.Post,
                "/internal/addin/pair/begin",
                "{"panel_id":"" + Escape(panelId) + ""}",
                token);

            if (!response.Ok)
            {
                throw new InvalidOperationException(
                    response.Error ?? "ADDIN_PAIR_FAILED");
            }
        }

        public async Task<bool> IsPairedAsync(
            string panelId,
            CancellationToken token)
        {
            var response = await SendAsync(
                HttpMethod.Get,
                "/internal/addin/pair/status?panel_id=" +
                    Uri.EscapeDataString(panelId),
                null,
                token);

            return response.Ok && response.Paired;
        }

        public async Task<AddinControlResponse> ConnectDrawingAsync(
            string panelId,
            string drawingSelector,
            CancellationToken token)
        {
            return await SendAsync(
                HttpMethod.Post,
                "/internal/addin/connect-drawing",
                "{"panel_id":"" + Escape(panelId) +
                    "","drawing_selector":"" +
                    Escape(drawingSelector) + ""}",
                token);
        }

        public async Task<bool> WaitForPairAsync(
            string panelId,
            TimeSpan timeout,
            CancellationToken token)
        {
            var deadline = DateTime.UtcNow + timeout;
            while (DateTime.UtcNow < deadline)
            {
                token.ThrowIfCancellationRequested();
                try
                {
                    if (await IsPairedAsync(panelId, token))
                    {
                        return true;
                    }
                }
                catch
                {
                    // The admission request may still be in flight.
                }

                await Task.Delay(250, token);
            }

            return false;
        }

        private static async Task<AddinControlResponse> SendAsync(
            HttpMethod method,
            string path,
            string? json,
            CancellationToken token)
        {
            var descriptor = ReadDescriptor();
            var uri = new Uri(
                "http://127.0.0.1:" +
                descriptor.Port +
                path,
                UriKind.Absolute);

            using (var request = new HttpRequestMessage(method, uri))
            {
                request.Headers.TryAddWithoutValidation(
                    "x-cadgpt-addin-token",
                    descriptor.Token);

                if (json != null)
                {
                    request.Content = new StringContent(
                        json,
                        Encoding.UTF8,
                        "application/json");
                }

                using (var response = await Http.SendAsync(request, token))
                {
                    var raw = await response.Content.ReadAsStringAsync();
                    var payload = DeserializeResponse(raw);
                    if (!response.IsSuccessStatusCode && payload.Ok)
                    {
                        payload.Ok = false;
                    }

                    return payload;
                }
            }
        }

        private static AddinControlDescriptor ReadDescriptor()
        {
            if (!File.Exists(DescriptorPath))
            {
                throw new InvalidOperationException(
                    "ADDIN_CONTROL_DESCRIPTOR_MISSING");
            }

            var raw = File.ReadAllText(DescriptorPath);
            var serializer = new DataContractJsonSerializer(
                typeof(AddinControlDescriptor));
            using (var stream = new MemoryStream(
                Encoding.UTF8.GetBytes(raw)))
            {
                var descriptor =
                    (AddinControlDescriptor?)serializer.ReadObject(stream);
                if (descriptor == null ||
                    descriptor.SchemaVersion != 1 ||
                    !string.Equals(
                        descriptor.Host,
                        "127.0.0.1",
                        StringComparison.Ordinal) ||
                    descriptor.Port <= 0 ||
                    descriptor.Port > 65535 ||
                    string.IsNullOrWhiteSpace(descriptor.Token))
                {
                    throw new InvalidOperationException(
                        "ADDIN_CONTROL_DESCRIPTOR_INVALID");
                }

                return descriptor;
            }
        }

        private static AddinControlResponse DeserializeResponse(string raw)
        {
            try
            {
                var serializer = new DataContractJsonSerializer(
                    typeof(AddinControlResponse));
                using (var stream = new MemoryStream(
                    Encoding.UTF8.GetBytes(raw)))
                {
                    return (AddinControlResponse?)serializer.ReadObject(stream)
                        ?? new AddinControlResponse
                        {
                            Ok = false,
                            Error = "ADDIN_CONTROL_RESPONSE_EMPTY"
                        };
                }
            }
            catch
            {
                return new AddinControlResponse
                {
                    Ok = false,
                    Error = "ADDIN_CONTROL_RESPONSE_INVALID"
                };
            }
        }

        private static string Escape(string value)
        {
            return value
                .Replace("\\", "\\\\")
                .Replace(""", "\\"")
                .Replace("\r", "\\r")
                .Replace("\n", "\\n");
        }
    }
}
