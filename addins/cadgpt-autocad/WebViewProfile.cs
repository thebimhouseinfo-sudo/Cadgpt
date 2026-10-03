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
        private static string ChromeThemePath => Path.Combine(RootPath, "panel-theme.txt");

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

        public static string ReadChromeTheme()
        {
            try
            {
                if (!File.Exists(ChromeThemePath))
                {
                    return "light";
                }

                var value = File.ReadAllText(ChromeThemePath).Trim().ToLowerInvariant();
                return value == "dark" ? "dark" : "light";
            }
            catch
            {
                return "light";
            }
        }

        public static void TrySaveChromeTheme(string theme)
        {
            var value = string.Equals(
                theme,
                "dark",
                StringComparison.OrdinalIgnoreCase)
                ? "dark"
                : "light";

            try
            {
                EnsureDirectories();
                File.WriteAllText(ChromeThemePath, value);
            }
            catch
            {
                // Theme preference is convenience state only.
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
