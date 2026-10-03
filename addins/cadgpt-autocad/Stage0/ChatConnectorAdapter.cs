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

    internal sealed class ConnectorTurnResult
    {
        public bool Success { get; set; }
        public string Method { get; set; } = string.Empty;
        public string FailureCode { get; set; } = string.Empty;
    }

    internal sealed class ChatConnectorAdapter
    {
        private readonly WebView2 _browser;

        public ChatConnectorAdapter(WebView2 browser)
        {
            _browser = browser ?? throw new ArgumentNullException(nameof(browser));
        }

        public async Task<ConnectorTurnResult> InvokeCadGptAsync(
            CancellationToken token)
        {
            token.ThrowIfCancellationRequested();
            if (_browser.CoreWebView2 == null)
            {
                return new ConnectorTurnResult
                {
                    Success = false,
                    FailureCode = "WEBVIEW_NOT_READY",
                    Method = ChatConnectorScript.AdapterVersion
                };
            }

            var json = await _browser.CoreWebView2.ExecuteScriptAsync(
                ChatConnectorScript.BuildInvokeCadGptScript());
            token.ThrowIfCancellationRequested();

            var result = Deserialize(json);
            return new ConnectorTurnResult
            {
                Success = result.Success,
                FailureCode = result.Success
                    ? string.Empty
                    : (result.Code ?? "SCRIPT_FAILED"),
                Method = result.Method ?? ChatConnectorScript.AdapterVersion
            };
        }

        private static ConnectorScriptResult Deserialize(string json)
        {
            try
            {
                var serializer = new DataContractJsonSerializer(
                    typeof(ConnectorScriptResult));
                using (var stream = new MemoryStream(
                    Encoding.UTF8.GetBytes(json)))
                {
                    return (ConnectorScriptResult?)serializer.ReadObject(stream)
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
