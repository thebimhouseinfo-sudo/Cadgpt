using System;
using System.IO;
using System.Runtime.Serialization;
using System.Runtime.Serialization.Json;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Web.WebView2.Wpf;

namespace CadGpt.AutoCad.Stage0
{
    [DataContract]
    internal sealed class ChatScriptResult
    {
        [DataMember(Name = "success")]
        public bool Success { get; set; }

        [DataMember(Name = "code")]
        public string? Code { get; set; }

        [DataMember(Name = "method")]
        public string? Method { get; set; }

        [DataMember(Name = "url")]
        public string? Url { get; set; }

        [DataMember(Name = "count")]
        public int Count { get; set; }
    }

    internal sealed class ChatNavigationObservation
    {
        public bool Success { get; set; }
        public string Method { get; set; } = string.Empty;
        public string FailureCode { get; set; } = string.Empty;
        public string ReferenceHash { get; set; } = string.Empty;
        public string? ConversationUrl { get; set; }
    }

    internal sealed class ChatNavigationAdapter
    {
        private readonly WebView2 _browser;

        public ChatNavigationAdapter(WebView2 browser)
        {
            _browser = browser ?? throw new ArgumentNullException(nameof(browser));
        }

        public async Task<ChatNavigationObservation> CreateNewChatAsync(
            CancellationToken token)
        {
            return await ExecuteAsync(ChatNavigationScript.NewChat(), token);
        }

        public async Task<ChatNavigationObservation> InvokeCadGptAsync(
            CancellationToken token)
        {
            return await ExecuteAsync(ChatNavigationScript.InvokeCadGpt(), token);
        }

        public async Task<ChatNavigationObservation> SendContinuationProbeAsync(
            CancellationToken token)
        {
            return await ExecuteAsync(
                ChatNavigationScript.ContinuationProbe(),
                token);
        }

        public async Task<ChatNavigationObservation> WaitForConversationAsync(
            TimeSpan timeout,
            CancellationToken token)
        {
            var deadline = DateTime.UtcNow + timeout;
            while (DateTime.UtcNow < deadline)
            {
                token.ThrowIfCancellationRequested();
                var raw = _browser.Source?.AbsoluteUri;
                var normalized = WebViewProfile.NormalizeConversationUrl(raw);
                if (normalized != null)
                {
                    return new ChatNavigationObservation
                    {
                        Success = true,
                        Method = "visible-conversation-url",
                        ConversationUrl = normalized,
                        ReferenceHash = HashReference(normalized)
                    };
                }

                await Task.Delay(200, token);
            }

            return new ChatNavigationObservation
            {
                Success = false,
                FailureCode = "CONVERSATION_URL_TIMEOUT",
                Method = "visible-conversation-url"
            };
        }

        public async Task NavigateConversationAsync(
            string conversationUrl,
            CancellationToken token)
        {
            var normalized = WebViewProfile.NormalizeConversationUrl(conversationUrl);
            if (normalized == null)
            {
                throw new InvalidOperationException("STAGE0_INVALID_CONVERSATION_URL");
            }

            token.ThrowIfCancellationRequested();
            _browser.CoreWebView2.Navigate(normalized);
            await WaitUntilUrlAsync(normalized, TimeSpan.FromSeconds(30), token);
        }

        private async Task<ChatNavigationObservation> ExecuteAsync(
            string script,
            CancellationToken token)
        {
            token.ThrowIfCancellationRequested();
            if (_browser.CoreWebView2 == null)
            {
                return new ChatNavigationObservation
                {
                    Success = false,
                    FailureCode = "WEBVIEW_NOT_READY",
                    Method = ChatNavigationScript.AdapterVersion
                };
            }

            var json = await _browser.CoreWebView2.ExecuteScriptAsync(script);
            token.ThrowIfCancellationRequested();
            var result = Deserialize(json);
            var normalized = WebViewProfile.NormalizeConversationUrl(result.Url);

            return new ChatNavigationObservation
            {
                Success = result.Success,
                FailureCode = result.Success ? string.Empty : (result.Code ?? "SCRIPT_FAILED"),
                Method = result.Method ?? ChatNavigationScript.AdapterVersion,
                ConversationUrl = normalized,
                ReferenceHash = normalized == null ? string.Empty : HashReference(normalized)
            };
        }

        private async Task WaitUntilUrlAsync(
            string normalizedUrl,
            TimeSpan timeout,
            CancellationToken token)
        {
            var deadline = DateTime.UtcNow + timeout;
            while (DateTime.UtcNow < deadline)
            {
                token.ThrowIfCancellationRequested();
                var current = WebViewProfile.NormalizeConversationUrl(
                    _browser.Source?.AbsoluteUri);
                if (string.Equals(
                    current,
                    normalizedUrl,
                    StringComparison.OrdinalIgnoreCase))
                {
                    return;
                }

                await Task.Delay(150, token);
            }

            throw new TimeoutException("STAGE0_NAVIGATION_TIMEOUT");
        }

        internal static string HashReference(string value)
        {
            using (var sha = SHA256.Create())
            {
                var bytes = sha.ComputeHash(Encoding.UTF8.GetBytes(value));
                var builder = new StringBuilder();
                for (var i = 0; i < 12; i++)
                {
                    builder.Append(bytes[i].ToString("x2"));
                }

                return builder.ToString();
            }
        }

        private static ChatScriptResult Deserialize(string json)
        {
            try
            {
                var serializer = new DataContractJsonSerializer(
                    typeof(ChatScriptResult));
                using (var stream = new MemoryStream(Encoding.UTF8.GetBytes(json)))
                {
                    return (ChatScriptResult?)serializer.ReadObject(stream)
                        ?? new ChatScriptResult
                        {
                            Success = false,
                            Code = "SCRIPT_RESULT_EMPTY"
                        };
                }
            }
            catch
            {
                return new ChatScriptResult
                {
                    Success = false,
                    Code = "SCRIPT_RESULT_INVALID"
                };
            }
        }
    }
}
