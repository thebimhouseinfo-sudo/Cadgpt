using System;
using System.IO;
using System.Runtime.Serialization;
using System.Runtime.Serialization.Json;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Web.WebView2.Wpf;

namespace CadGpt.AutoCad.Stage0
{
    [DataContract]
    internal sealed class ConnectorScriptResult
    {
        [DataMember(Name = "success")]
        public bool Success { get; set; }

        [DataMember(Name = "code")]
        public string? Code { get; set; }

        [DataMember(Name = "method")]
        public string? Method { get; set; }
    }

    internal sealed class ChatConnectorAdapter
    {
        private readonly WebView2 _browser;

        public ChatConnectorAdapter(WebView2 browser)
        {
            _browser = browser;
        }

        public async Task<string> InvokeCadGptAsync(
            CancellationToken token)
        {
            token.ThrowIfCancellationRequested();
            if (_browser.CoreWebView2 == null)
            {
                return "WEBVIEW_NOT_READY";
            }

            var json =
                await _browser.CoreWebView2.ExecuteScriptAsync(
                    ChatConnectorScript.InvokeCadGpt());
            token.ThrowIfCancellationRequested();

            var result = Deserialize(json);
            return result.Success
                ? string.Empty
                : (result.Code ?? "SCRIPT_FAILED");
        }

        private static ConnectorScriptResult Deserialize(
            string json)
        {
            try
            {
                var serializer =
                    new DataContractJsonSerializer(
                        typeof(ConnectorScriptResult));
                using (var stream =
                    new MemoryStream(
                        Encoding.UTF8.GetBytes(json)))
                {
                    return
                        (ConnectorScriptResult?)
                        serializer.ReadObject(stream)
                        ?? new ConnectorScriptResult
                        {
                            Success = false,
                            Code = "SCRIPT_RESULT_EMPTY"
                        };
                }
            }
            catch
            {
                return new ConnectorScriptResult
                {
                    Success = false,
                    Code = "SCRIPT_RESULT_INVALID"
                };
            }
        }
    }
}
