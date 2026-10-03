using System;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using CadGpt.AutoCad.Stage0;
using Microsoft.Web.WebView2.Core;

namespace CadGpt.AutoCad
{
    public partial class ChatView : UserControl, IDisposable
    {
        private readonly PaletteLifecycleState _lifecycle = new PaletteLifecycleState();
        private CancellationTokenSource? _initializeCts;
        private bool _disposed;

        public event EventHandler? RecreateRequested;

        public ChatView()
        {
            InitializeComponent();
            Loaded += OnLoaded;
        }

        private async void OnLoaded(object sender, RoutedEventArgs e)
        {
            Loaded -= OnLoaded;
            await InitializeBrowserAsync();
        }

        private async Task InitializeBrowserAsync()
        {
            if (_disposed)
            {
                return;
            }

            CancelInitialization();
            _initializeCts = new CancellationTokenSource();
            var token = _initializeCts.Token;
            var generation = _lifecycle.BeginInitialization();
            SetStatus("CadGPT Stage 0 — initializing WebView2");

            try
            {
                WebViewProfile.EnsureDirectories();
                var environment = await CoreWebView2Environment.CreateAsync(null, WebViewProfile.UserDataPath);
                token.ThrowIfCancellationRequested();

                await Browser.EnsureCoreWebView2Async(environment);
                token.ThrowIfCancellationRequested();

                if (!_lifecycle.IsCurrent(generation) || _disposed)
                {
                    return;
                }

                Browser.NavigationCompleted -= Browser_NavigationCompleted;
                Browser.NavigationCompleted += Browser_NavigationCompleted;

                var target = WebViewProfile.ReadLastConversationUrl() ?? "https://chatgpt.com/";
                Browser.CoreWebView2.Navigate(target);

                _lifecycle.MarkReady(generation);
                SetStatus("CadGPT Stage 0 — WebView2 ready");
            }
            catch (OperationCanceledException)
            {
            }
            catch (Exception ex)
            {
                _lifecycle.MarkFailed(generation, "WEBVIEW_INIT_FAILED");
                SetStatus("CadGPT Stage 0 — WebView2 failed: " + ex.GetType().Name);
            }
        }

        private void Browser_NavigationCompleted(object? sender, CoreWebView2NavigationCompletedEventArgs e)
        {
            if (!e.IsSuccess)
            {
                SetStatus("CadGPT Stage 0 — navigation failed");
                return;
            }

            WebViewProfile.TrySaveConversationUrl(Browser.Source?.AbsoluteUri);
            SetStatus("CadGPT Stage 0 — ChatGPT loaded");
        }

        private void ReloadButton_Click(object sender, RoutedEventArgs e)
        {
            if (Browser.CoreWebView2 != null)
            {
                Browser.Reload();
            }
        }

        private async void RetryButton_Click(object sender, RoutedEventArgs e)
        {
            await InitializeBrowserAsync();
        }

        private void RecreateButton_Click(object sender, RoutedEventArgs e)
        {
            RecreateRequested?.Invoke(this, EventArgs.Empty);
        }

        private void SetStatus(string value)
        {
            StatusText.Text = value;
        }

        private void CancelInitialization()
        {
            if (_initializeCts == null)
            {
                return;
            }

            try { _initializeCts.Cancel(); } catch { }
            _initializeCts.Dispose();
            _initializeCts = null;
        }

        public void Dispose()
        {
            if (_disposed)
            {
                return;
            }

            _disposed = true;
            var generation = _lifecycle.BeginDispose();
            Loaded -= OnLoaded;
            CancelInitialization();
            Browser.NavigationCompleted -= Browser_NavigationCompleted;
            Browser.Dispose();
            _lifecycle.CompleteDispose(generation);
        }
    }
}
