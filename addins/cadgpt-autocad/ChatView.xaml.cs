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
        private readonly PaletteLifecycleState _lifecycle =
            new PaletteLifecycleState();
        private readonly CancellationTokenSource _actionCts =
            new CancellationTokenSource();
        private readonly SemaphoreSlim _pairGate =
            new SemaphoreSlim(1, 1);
        private readonly AddinControlClient _control =
            new AddinControlClient();

        private CancellationTokenSource? _initializeCts;
        private ChatConnectorAdapter? _connector;
        private string? _pairId;
        private bool _disposed;
        private bool _darkChrome;

        public event EventHandler? RecreateRequested;

        public ChatView()
        {
            InitializeComponent();

            _pairId = _control.ReadSavedPairId();
            _darkChrome = string.Equals(
                WebViewProfile.ReadChromeTheme(),
                "dark",
                StringComparison.OrdinalIgnoreCase);
            ApplyChromeTheme();

            Loaded += OnLoaded;
            Browser.PreviewMouseDown += Browser_PreviewMouseDown;
        }

        private async void OnLoaded(
            object sender,
            RoutedEventArgs e)
        {
            Loaded -= OnLoaded;
            await InitializeBrowserAsync();
        }

        private async Task InitializeBrowserAsync()
        {
            if (_disposed ||
                _lifecycle.Phase ==
                PaletteLifecyclePhase.Initializing)
            {
                return;
            }

            CancelInitialization();
            _initializeCts =
                new CancellationTokenSource();
            var token = _initializeCts.Token;
            var generation =
                _lifecycle.BeginInitialization();
            SetStatus("CadGPT — initializing");

            try
            {
                WebViewProfile.EnsureDirectories();
                var environment =
                    await CoreWebView2Environment.CreateAsync(
                        null,
                        WebViewProfile.UserDataPath);
                token.ThrowIfCancellationRequested();

                await Browser.EnsureCoreWebView2Async(
                    environment);
                token.ThrowIfCancellationRequested();

                if (!_lifecycle.IsCurrent(generation) ||
                    _disposed)
                {
                    return;
                }

                _connector =
                    new ChatConnectorAdapter(Browser);
                Browser.NavigationCompleted -=
                    Browser_NavigationCompleted;
                Browser.NavigationCompleted +=
                    Browser_NavigationCompleted;

                var target =
                    WebViewProfile.ReadLastConversationUrl()
                    ?? "https://chatgpt.com/";
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
                SetStatus(
                    "CadGPT — navigation failed");
                return;
            }

            var current =
                Browser.Source?.AbsoluteUri;
            WebViewProfile.TrySaveConversationUrl(
                current);

            if (WebViewProfile.NormalizeConversationUrl(
                    current) == null)
            {
                SetStatus("CadGPT — ChatGPT loaded");
                return;
            }

            SetStatus("CadGPT — checking connection");
            await EnsurePairedAsync(
                _actionCts.Token);
        }

        private async Task<bool> EnsurePairedAsync(
            CancellationToken token)
        {
            await _pairGate.WaitAsync(token);
            try
            {
                if (_disposed)
                {
                    return false;
                }

                if (!string.IsNullOrWhiteSpace(
                    _pairId))
                {
                    try
                    {
                        var current =
                            await _control.GetPairStatusAsync(
                                _pairId,
                                token);
                        if (current.Paired &&
                            current.ControllerReady)
                        {
                            SetStatus(
                                "CadGPT — connected");
                            return true;
                        }
                    }
                    catch (AddinControlException)
                    {
                    }

                    _pairId = null;
                    _control.ClearSavedPairId();
                }

                if (_connector == null)
                {
                    SetStatus(
                        "CadGPT — WebView not ready");
                    return false;
                }

                AddinPairResponse pair;
                try
                {
                    pair =
                        await _control.StartPairAsync(
                            token);
                }
                catch (AddinControlException error)
                {
                    SetStatus(
                        "CadGPT — runtime unavailable: " +
                        error.Message);
                    return false;
                }

                if (!pair.Ok ||
                    string.IsNullOrWhiteSpace(
                        pair.PairId))
                {
                    SetStatus(
                        "CadGPT — pairing unavailable");
                    return false;
                }

                _pairId = pair.PairId;
                SetStatus(
                    "CadGPT — connecting @cg");

                var invocationError =
                    await _connector.InvokeCadGptAsync(
                        token);
                if (!string.IsNullOrWhiteSpace(
                    invocationError))
                {
                    SetStatus(
                        "CadGPT — @cg failed: " +
                        invocationError);
                    _pairId = null;
                    return false;
                }

                var deadline =
                    DateTime.UtcNow.AddSeconds(25);
                while (DateTime.UtcNow < deadline)
                {
                    token.ThrowIfCancellationRequested();

                    try
                    {
                        var status =
                            await _control
                                .GetPairStatusAsync(
                                    pair.PairId,
                                    token);
                        if (status.Paired &&
                            status.ControllerReady)
                        {
                            _control.SavePairId(
                                pair.PairId);
                            SetStatus(
                                "CadGPT — connected");
                            return true;
                        }
                    }
                    catch (AddinControlException)
                    {
                        break;
                    }

                    await Task.Delay(
                        300,
                        token);
                }

                SetStatus(
                    "CadGPT — pairing timeout");
                _pairId = null;
                return false;
            }
            catch (OperationCanceledException)
            {
                return false;
            }
            finally
            {
                _pairGate.Release();
            }
        }

        private async void ConnectButton_Click(
            object sender,
            RoutedEventArgs e)
        {
            if (_disposed)
            {
                return;
            }

            var selector =
                ActiveDrawingSelector();
            if (string.IsNullOrWhiteSpace(
                selector))
            {
                SetStatus(
                    "CadGPT — no active drawing");
                return;
            }

            ConnectButton.IsEnabled = false;
            try
            {
                if (!await EnsurePairedAsync(
                    _actionCts.Token))
                {
                    return;
                }

                SetStatus(
                    "CadGPT — connecting drawing");

                AddinConnectResponse result;
                try
                {
                    result =
                        await _control.ConnectDrawingAsync(
                            _pairId!,
                            selector,
                            _actionCts.Token);
                }
                catch (AddinControlException error)
                    when (
                        error.Message ==
                            "ADDIN_PAIR_REQUIRED" ||
                        error.Message ==
                            "ADDIN_SESSION_UNAVAILABLE")
                {
                    _pairId = null;
                    _control.ClearSavedPairId();

                    if (!await EnsurePairedAsync(
                        _actionCts.Token))
                    {
                        return;
                    }

                    result =
                        await _control.ConnectDrawingAsync(
                            _pairId!,
                            selector,
                            _actionCts.Token);
                }

                if (!result.Ok)
                {
                    SetStatus(
                        "CadGPT — connect failed");
                    return;
                }

                var label =
                    result.Drawing?.FullName;
                if (string.IsNullOrWhiteSpace(
                    label))
                {
                    label =
                        result.Drawing?.Name;
                }

                SetStatus(
                    string.IsNullOrWhiteSpace(label)
                        ? "CadGPT — drawing connected"
                        : "CadGPT — " + label);
            }
            catch (OperationCanceledException)
            {
            }
            catch (AddinControlException error)
            {
                SetStatus(
                    "CadGPT — connect failed: " +
                    error.Message);
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

        private static string? ActiveDrawingSelector()
        {
            try
            {
                var document =
                    AcApplication.DocumentManager
                        .MdiActiveDocument;
                if (document == null)
                {
                    return null;
                }

                var filename =
                    document.Database.Filename;
                if (!string.IsNullOrWhiteSpace(
                    filename))
                {
                    return filename.Trim();
                }

                return
                    string.IsNullOrWhiteSpace(
                        document.Name)
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
                SetStatus(
                    "CadGPT — refreshing");
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
                _darkChrome
                    ? "dark"
                    : "light");
        }

        private void ApplyChromeTheme()
        {
            var background =
                new SolidColorBrush(
                    _darkChrome
                        ? Color.FromRgb(
                            24, 24, 24)
                        : Color.FromRgb(
                            255, 255, 255));
            var foreground =
                new SolidColorBrush(
                    _darkChrome
                        ? Color.FromRgb(
                            245, 245, 245)
                        : Color.FromRgb(
                            30, 30, 30));
            var buttonBackground =
                new SolidColorBrush(
                    _darkChrome
                        ? Color.FromRgb(
                            45, 45, 45)
                        : Color.FromRgb(
                            245, 245, 245));
            var border =
                new SolidColorBrush(
                    _darkChrome
                        ? Color.FromRgb(
                            65, 65, 65)
                        : Color.FromRgb(
                            220, 220, 220));

            RootGrid.Background = background;
            ToolbarBorder.Background =
                background;
            ToolbarBorder.BorderBrush = border;
            StatusText.Foreground = foreground;

            foreach (var button in new[]
            {
                ConnectButton,
                RefreshButton,
                ThemeButton
            })
            {
                button.Background =
                    buttonBackground;
                button.Foreground =
                    foreground;
                button.BorderBrush = border;
            }

            ThemeButton.Content =
                _darkChrome
                    ? "Light"
                    : "Dark";
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
            Dispatcher.BeginInvoke(
                new Action(() =>
                {
                    if (!_disposed)
                    {
                        RecreateRequested?.Invoke(
                            this,
                            EventArgs.Empty);
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
            var generation =
                _lifecycle.BeginDispose();

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
            _pairGate.Dispose();
            CancelInitialization();
            Browser.Dispose();
            _lifecycle.CompleteDispose(
                generation);
        }
    }
}
