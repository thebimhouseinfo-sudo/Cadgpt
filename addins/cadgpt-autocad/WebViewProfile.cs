using System;
using System.IO;

namespace CadGpt.AutoCad
{
    internal static class WebViewProfile
    {
        private const string ChatGptOrigin = "https://chatgpt.com/";

        public static string RootPath
        {
            get
            {
                var local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
                return Path.Combine(local, "CadGPT", "runtime", "autocad-addin");
            }
        }

        public static string UserDataPath => Path.Combine(RootPath, "stage0-webview2");

        private static string LastConversationPath => Path.Combine(RootPath, "stage0-last-chat-url.txt");

        public static void EnsureDirectories()
        {
            Directory.CreateDirectory(RootPath);
            Directory.CreateDirectory(UserDataPath);
        }

        public static string? ReadLastConversationUrl()
        {
            try
            {
                if (!File.Exists(LastConversationPath))
                {
                    return null;
                }

                var value = File.ReadAllText(LastConversationPath).Trim();
                return IsSafeChatGptUrl(value) ? value : null;
            }
            catch
            {
                return null;
            }
        }

        public static void TrySaveConversationUrl(string? url)
        {
            if (!IsSafeChatGptUrl(url))
            {
                return;
            }

            try
            {
                EnsureDirectories();
                File.WriteAllText(LastConversationPath, url!);
            }
            catch
            {
                // Convenience persistence must never make the palette unusable.
            }
        }

        private static bool IsSafeChatGptUrl(string? value)
        {
            if (string.IsNullOrWhiteSpace(value))
            {
                return false;
            }

            if (!Uri.TryCreate(value, UriKind.Absolute, out var uri))
            {
                return false;
            }

            return uri.Scheme == Uri.UriSchemeHttps &&
                   string.Equals(uri.Host, "chatgpt.com", StringComparison.OrdinalIgnoreCase) &&
                   value.StartsWith(ChatGptOrigin, StringComparison.OrdinalIgnoreCase);
        }
    }
}
