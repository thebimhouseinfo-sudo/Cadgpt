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

        [DataMember(Name = "count")]
        public int Count { get; set; }
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
            var core = _browser.CoreWebView2;
            if (core == null)
            {
                return "WEBVIEW_NOT_READY";
            }

            var prepared = await ExecuteStageAsync(
                ChatConnectorScript.PrepareComposer(),
                token);
            if (!prepared.Success)
            {
                return prepared.Code ?? "PREPARE_COMPOSER_FAILED";
            }

            await core.CallDevToolsProtocolMethodAsync(
                "Input.insertText",
                "{\"text\":\"@cg\"}");
            token.ThrowIfCancellationRequested();

            await Task.Delay(500, token);

            ConnectorScriptResult selected =
                new ConnectorScriptResult
                {
                    Success = false,
                    Code = "CG_CONNECTOR_NOT_FOUND"
                };
            var suggestionDeadline =
                DateTime.UtcNow.AddSeconds(6);
            while (DateTime.UtcNow < suggestionDeadline)
            {
                selected = await ExecuteStageAsync(
                    ChatConnectorScript.SelectCadGptSuggestion(),
                    token);
                if (selected.Success)
                {
                    break;
                }

                if (!string.Equals(
                    selected.Code,
                    "CG_CONNECTOR_NOT_FOUND",
                    StringComparison.Ordinal))
                {
                    return selected.Code ??
                        "CG_CONNECTOR_SELECTION_FAILED";
                }

                await Task.Delay(300, token);
            }

            if (!selected.Success)
            {
                return selected.Code ??
                    "CG_CONNECTOR_SELECTION_TIMEOUT";
            }

            await Task.Delay(300, token);

            var refocused = await ExecuteStageAsync(
                ChatConnectorScript.RefocusComposer(),
                token);
            if (!refocused.Success)
            {
                return refocused.Code ?? "COMPOSER_REFOCUS_FAILED";
            }

            await core.CallDevToolsProtocolMethodAsync(
                "Input.dispatchKeyEvent",
                "{\"type\":\"keyDown\",\"key\":\"Enter\",\"code\":\"Enter\",\"windowsVirtualKeyCode\":13,\"nativeVirtualKeyCode\":13}");
            await core.CallDevToolsProtocolMethodAsync(
                "Input.dispatchKeyEvent",
                "{\"type\":\"keyUp\",\"key\":\"Enter\",\"code\":\"Enter\",\"windowsVirtualKeyCode\":13,\"nativeVirtualKeyCode\":13}");

            return string.Empty;
        }

        private async Task<ConnectorScriptResult> ExecuteStageAsync(
            string script,
            CancellationToken token)
        {
            token.ThrowIfCancellationRequested();
            var core = _browser.CoreWebView2;
            if (core == null)
            {
                return new ConnectorScriptResult
                {
                    Success = false,
                    Code = "WEBVIEW_NOT_READY"
                };
            }

            var json = await core.ExecuteScriptAsync(script);
            token.ThrowIfCancellationRequested();
            return Deserialize(json);
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
