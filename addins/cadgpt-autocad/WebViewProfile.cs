using System;
using System.IO;

namespace CadGpt.AutoCad
{
    internal static class WebViewProfile
    {
        public const string StartupUrl =
            "https://chatgpt.com/";

        public static string RootPath
        {
            get
            {
                var local = Environment.GetFolderPath(
                    Environment.SpecialFolder.LocalApplicationData);
                return Path.Combine(
                    local,
                    "CadGPT",
                    "runtime",
                    "autocad-addin");
            }
        }

        public static string UserDataPath =>
            Path.Combine(
                RootPath,
                "stage0-webview2");

        private static string LegacyLastConversationPath =>
            Path.Combine(
                RootPath,
                "stage0-last-chat-url.txt");

        private static string ChromeThemePath =>
            Path.Combine(
                RootPath,
                "panel-theme.txt");

        public static void EnsureDirectories()
        {
            Directory.CreateDirectory(RootPath);
            Directory.CreateDirectory(UserDataPath);

            // Older builds pinned the palette to one specific ChatGPT
            // conversation URL. That conversation may later be deleted,
            // renamed, or simply no longer be the user's intended chat.
            // Preserve the WebView2 profile/login, but remove the obsolete
            // conversation pointer so startup behaves like normal ChatGPT.
            try
            {
                if (File.Exists(
                    LegacyLastConversationPath))
                {
                    File.Delete(
                        LegacyLastConversationPath);
                }
            }
            catch
            {
                // Legacy convenience state must never block the palette.
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

                var value =
                    File.ReadAllText(
                        ChromeThemePath)
                    .Trim()
                    .ToLowerInvariant();

                return value == "dark"
                    ? "dark"
                    : "light";
            }
            catch
            {
                return "light";
            }
        }

        public static void TrySaveChromeTheme(
            string theme)
        {
            var value =
                string.Equals(
                    theme,
                    "dark",
                    StringComparison.OrdinalIgnoreCase)
                    ? "dark"
                    : "light";

            try
            {
                EnsureDirectories();
                File.WriteAllText(
                    ChromeThemePath,
                    value);
            }
            catch
            {
                // Theme preference is convenience state only.
            }
        }
    }
}
