using System;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using CadGpt.AutoCad.Stage0;
using Microsoft.Web.WebView2.Core;
using AcApplication = Autodesk.AutoCAD.ApplicationServices.Application;

namespace CadGpt.AutoCad
{
    public partial class ChatView : UserControl, IDisposable
    {
        private readonly PaletteLifecycleState _lifecycle = new PaletteLifecycleState();
        private readonly CancellationTokenSource _actionCts = new CancellationTokenSource();
        private CancellationTokenSource? _initializeCts;
        private ChatConnectorAdapter? _connector;
        private bool _disposed;
        private bool _darkChrome;
        private bool _autoInvokeCompleted;
        private bool _autoInvokeInProgress;

        public event EventHandler? RecreateRequested;

        public ChatView()
        {
            InitializeComponent();
            _darkChrome = string.Equals(
                WebViewProfile.ReadChromeTheme(),
                "dark",
                StringComparison.OrdinalIgnoreCase);
            ApplyChromeTheme();

            Loaded += OnLoaded;
            Browser.PreviewMouseDown += Browser_PreviewMouseDown;
        }

        private async void OnLoaded(object sender, RoutedEventArgs e)
        {
            Loaded -= OnLoaded;
            await InitializeBrowserAsync();
        }

        private async Task InitializeBrowserAsync()
        {
            if (_disposed || _lifecycle.Phase == PaletteLifecyclePhase.Initializing)
            {
                return;
            }

            CancelInitialization();
            _initializeCts = new CancellationTokenSource();
            var token = _initializeCts.Token;
            var generation = _lifecycle.BeginInitialization();
            SetStatus("CadGPT — initializing");

            try
            {
                WebViewProfile.EnsureDirectories();
                var environment = await CoreWebView2Environment.CreateAsync(
                    null,
                    WebViewProfile.UserDataPath);
                token.ThrowIfCancellationRequested();

                await Browser.EnsureCoreWebView2Async(environment);
                token.ThrowIfCancellationRequested();

                if (!_lifecycle.IsCurrent(generation) || _disposed)
                {
                    return;
                }

                _connector = new ChatConnectorAdapter(Browser);
                Browser.NavigationCompleted -= Browser_NavigationCompleted;
                Browser.NavigationCompleted += Browser_NavigationCompleted;

                var target =
                    WebViewProfile.ReadLastConversationUrl() ??
                    "https://chatgpt.com/";
                Browser.CoreWebView2.Navigate(target);

                _lifecycle.MarkReady(generation);
                FocusBrowser();
                SetStatus("CadGPT — ready");
            }
            catch (OperationCanceledException)
            {
            }
            catch (Exception ex)
            {
                if (_lifecycle.MarkFailed(
                    generation,
                    "WEBVIEW_INIT_FAILED") &&
                    !_disposed)
                {
                    SetStatus("CadGPT — failed: " + ex.GetType().Name);
                }
            }
        }

        private async void Browser_NavigationCompleted(
            object? sender,
            CoreWebView2NavigationCompletedEventArgs e)
        {
            if (!e.IsSuccess)
            {
                SetStatus("CadGPT — navigation failed");
                return;
            }

            var current = Browser.Source?.AbsoluteUri;
            WebViewProfile.TrySaveConversationUrl(current);
            SetStatus("CadGPT — ChatGPT loaded");

            if (WebViewProfile.NormalizeConversationUrl(current) != null)
            {
                await TryAutoInvokeCadGptAsync();
            }
        }

        private async Task TryAutoInvokeCadGptAsync()
        {
            if (_disposed ||
                _autoInvokeCompleted ||
                _autoInvokeInProgress ||
                _connector == null)
            {
                return;
            }

            _autoInvokeInProgress = true;
            try
            {
                var result = await _connector.SendCadGptTurnAsync(
                    string.Empty,
                    _actionCts.Token);

                if (result.Success)
                {
                    _autoInvokeCompleted = true;
                    SetStatus("CadGPT — connected");
                }
                else
                {
                    SetStatus(
                        "CadGPT — auto connect: " +
                        result.FailureCode);
                }
            }
            catch (OperationCanceledException)
            {
            }
            catch (Exception ex)
            {
                SetStatus(
                    "CadGPT — auto connect failed: " +
                    ex.GetType().Name);
            }
            finally
            {
                _autoInvokeInProgress = false;
            }
        }

        private async void ConnectButton_Click(
            object sender,
            RoutedEventArgs e)
        {
            if (_disposed || _connector == null)
            {
                SetStatus("CadGPT — WebView not ready");
                return;
            }

            var selector = ActiveDrawingSelector();
            if (string.IsNullOrWhiteSpace(selector))
            {
                SetStatus("CadGPT — no active drawing");
                return;
            }

            ConnectButton.IsEnabled = false;
            SetStatus("CadGPT — connecting drawing");

            try
            {
                var result = await _connector.SendCadGptTurnAsync(
                    "connect drawing: " + selector,
                    _actionCts.Token);

                SetStatus(
                    result.Success
                        ? "CadGPT — connect request sent"
                        : "CadGPT — connect failed: " +
                          result.FailureCode);
            }
            catch (OperationCanceledException)
            {
            }
            catch (Exception ex)
            {
                SetStatus(
                    "CadGPT — connect failed: " +
                    ex.GetType().Name);
            }
            finally
            {
                if (!_disposed)
                {
                    ConnectButton.IsEnabled = true;
                }
            }
        }

        private string? ActiveDrawingSelector()
        {
            try
            {
                var document =
                    AcApplication.DocumentManager.MdiActiveDocument;
                if (document == null)
                {
                    return null;
                }

                var filename = document.Database.Filename;
                if (!string.IsNullOrWhiteSpace(filename))
                {
                    return filename.Trim();
                }

                return string.IsNullOrWhiteSpace(document.Name)
                    ? null
                    : document.Name.Trim();
            }
            catch
            {
                return null;
            }
        }

        private void RefreshButton_Click(
            object sender,
            RoutedEventArgs e)
        {
            if (Browser.CoreWebView2 != null)
            {
                Browser.Reload();
                SetStatus("CadGPT — refreshing");
                return;
            }

            RequestCleanRecreate();
        }

        private void ThemeButton_Click(
            object sender,
            RoutedEventArgs e)
        {
            _darkChrome = !_darkChrome;
            ApplyChromeTheme();
            WebViewProfile.TrySaveChromeTheme(
                _darkChrome ? "dark" : "light");
        }

        private void ApplyChromeTheme()
        {
            var background = new SolidColorBrush(
                _darkChrome
                    ? Color.FromRgb(24, 24, 24)
                    : Color.FromRgb(255, 255, 255));
            var foreground = new SolidColorBrush(
                _darkChrome
                    ? Color.FromRgb(245, 245, 245)
                    : Color.FromRgb(30, 30, 30));
            var buttonBackground = new SolidColorBrush(
                _darkChrome
                    ? Color.FromRgb(45, 45, 45)
                    : Color.FromRgb(245, 245, 245));
            var border = new SolidColorBrush(
                _darkChrome
                    ? Color.FromRgb(65, 65, 65)
                    : Color.FromRgb(220, 220, 220));

            RootGrid.Background = background;
            ToolbarBorder.Background = background;
            ToolbarBorder.BorderBrush = border;
            StatusText.Foreground = foreground;

            foreach (var button in new[]
            {
                ConnectButton,
                RefreshButton,
                ThemeButton
            })
            {
                button.Background = buttonBackground;
                button.Foreground = foreground;
                button.BorderBrush = border;
            }

            ThemeButton.Content =
                _darkChrome ? "Light" : "Dark";
        }

        private void Browser_PreviewMouseDown(
            object sender,
            MouseButtonEventArgs e)
        {
            FocusBrowser();
        }

        private void FocusBrowser()
        {
            if (_disposed)
            {
                return;
            }

            Browser.Focus();
            Keyboard.Focus(Browser);
        }

        private void RequestCleanRecreate()
        {
            Dispatcher.BeginInvoke(new Action(() =>
            {
                if (!_disposed)
                {
                    RecreateRequested?.Invoke(this, EventArgs.Empty);
                }
            }));
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

            try
            {
                _initializeCts.Cancel();
            }
            catch
            {
            }

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
            Browser.PreviewMouseDown -= Browser_PreviewMouseDown;
            Browser.NavigationCompleted -= Browser_NavigationCompleted;

            try
            {
                _actionCts.Cancel();
            }
            catch
            {
            }

            _actionCts.Dispose();
            CancelInitialization();
            Browser.Dispose();
            _lifecycle.CompleteDispose(generation);
        }
    }
}
