using System;
using System.IO;

namespace CadGpt.AutoCad
{
    internal static class WebViewProfile
    {
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

                return NormalizeConversationUrl(File.ReadAllText(LastConversationPath).Trim());
            }
            catch
            {
                return null;
            }
        }

        public static void TrySaveConversationUrl(string? url)
        {
            var normalized = NormalizeConversationUrl(url);
            if (normalized == null)
            {
                return;
            }

            try
            {
                EnsureDirectories();
                File.WriteAllText(LastConversationPath, normalized);
            }
            catch
            {
                // Convenience persistence must never make the palette unusable.
            }
        }

        internal static string? NormalizeConversationUrl(string? value)
        {
            if (string.IsNullOrWhiteSpace(value) ||
                !Uri.TryCreate(value, UriKind.Absolute, out var uri) ||
                uri.Scheme != Uri.UriSchemeHttps ||
                !string.Equals(uri.Host, "chatgpt.com", StringComparison.OrdinalIgnoreCase) ||
                !uri.IsDefaultPort)
            {
                return null;
            }

            var path = uri.AbsolutePath;
            if (path.IndexOf("/c/", StringComparison.OrdinalIgnoreCase) < 0)
            {
                return null;
            }

            var builder = new UriBuilder(Uri.UriSchemeHttps, "chatgpt.com")
            {
                Path = path,
                Query = string.Empty,
                Fragment = string.Empty
            };
            return builder.Uri.AbsoluteUri.TrimEnd('/');
        }
    }
}
