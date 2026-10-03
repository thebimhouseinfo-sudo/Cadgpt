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
        private readonly LocalCadGptControlClient _localControl =
            new LocalCadGptControlClient();
        private readonly string _panelId =
            "panel-" + Guid.NewGuid().ToString("N");

        private CancellationTokenSource? _initializeCts;
        private ChatConnectorAdapter? _connector;
        private bool _disposed;
        private bool _darkChrome;
        private bool _paired;
        private bool _pairingInProgress;

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
            if (_disposed ||
                _lifecycle.Phase == PaletteLifecyclePhase.Initializing)
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
                var environment =
                    await CoreWebView2Environment.CreateAsync(
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
                Browser.NavigationCompleted -=
                    Browser_NavigationCompleted;
                Browser.NavigationCompleted +=
                    Browser_NavigationCompleted;

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
                    SetStatus(
                        "CadGPT — failed: " +
                        ex.GetType().Name);
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
                await EnsurePairedAsync();
            }
        }

        private async Task<bool> EnsurePairedAsync()
        {
            if (_disposed || _connector == null)
            {
                return false;
            }

            if (_pairingInProgress)
            {
                return _paired;
            }

            _pairingInProgress = true;
            try
            {
                try
                {
                    if (await _localControl.IsPairedAsync(
                        _panelId,
                        _actionCts.Token))
                    {
                        _paired = true;
                        SetStatus("CadGPT — connected");
                        return true;
                    }
                }
                catch
                {
                    _paired = false;
                }

                SetStatus("CadGPT — connecting chat");
                await _localControl.BeginPairAsync(
                    _panelId,
                    _actionCts.Token);

                var invoked = await _connector.InvokeCadGptAsync(
                    _actionCts.Token);
                if (!invoked.Success)
                {
                    _paired = false;
                    SetStatus(
                        "CadGPT — auto connect: " +
                        invoked.FailureCode);
                    return false;
                }

                _paired = await _localControl.WaitForPairAsync(
                    _panelId,
                    TimeSpan.FromSeconds(20),
                    _actionCts.Token);

                SetStatus(
                    _paired
                        ? "CadGPT — connected"
                        : "CadGPT — pairing timeout");
                return _paired;
            }
            catch (OperationCanceledException)
            {
                return false;
            }
            catch (Exception ex)
            {
                _paired = false;
                SetStatus(
                    "CadGPT — local control unavailable: " +
                    ex.GetType().Name);
                return false;
            }
            finally
            {
                _pairingInProgress = false;
            }
        }

        private async void ConnectButton_Click(
            object sender,
            RoutedEventArgs e)
        {
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
                if (!await EnsurePairedAsync())
                {
                    return;
                }

                var result = await _localControl.ConnectDrawingAsync(
                    _panelId,
                    selector,
                    _actionCts.Token);

                if (!result.Ok &&
                    (result.Error == "ADDIN_PANEL_NOT_PAIRED" ||
                     result.Error == "ADDIN_SESSION_UNAVAILABLE"))
                {
                    _paired = false;
                    if (await EnsurePairedAsync())
                    {
                        result = await _localControl.ConnectDrawingAsync(
                            _panelId,
                            selector,
                            _actionCts.Token);
                    }
                }

                if (!result.Ok)
                {
                    SetStatus(
                        "CadGPT — connect failed: " +
                        (result.Error ?? "UNKNOWN"));
                    return;
                }

                var label =
                    result.DrawingName ??
                    result.DrawingFullName ??
                    selector;
                SetStatus(
                    "CadGPT — connected: " + label);
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
            Browser.PreviewMouseDown -=
                Browser_PreviewMouseDown;
            Browser.NavigationCompleted -=
                Browser_NavigationCompleted;

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
