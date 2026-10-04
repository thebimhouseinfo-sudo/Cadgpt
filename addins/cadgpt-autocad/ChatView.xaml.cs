using System;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Threading;
using CadGpt.AutoCad.Stage0;
using Microsoft.Web.WebView2.Core;
using AcApplication = Autodesk.AutoCAD.ApplicationServices.Application;
using AcDocument = Autodesk.AutoCAD.ApplicationServices.Document;

namespace CadGpt.AutoCad
{
    public partial class ChatView : UserControl, IDisposable
    {
        private readonly PaletteLifecycleState _lifecycle =
            new PaletteLifecycleState();
        private readonly CancellationTokenSource _actionCts =
            new CancellationTokenSource();
        private readonly AddinControlClient _control =
            new AddinControlClient();

        private CancellationTokenSource? _initializeCts;
        private DispatcherTimer? _bindingTimer;
        private string? _pairId;
        private DateTime _pairExpiresUtc = DateTime.MinValue;
        private bool _disposed;
        private bool _darkChrome;
        private bool _pollInProgress;
        private AddinDrawingSummary? _lastConfirmedBoundDrawing;
        private bool _boundDrawingClosed;
        private bool _bindingMismatch;

        public ChatView()
        {
            InitializeComponent();

            _pairId = _control.ReadSavedPairId();
            _darkChrome = string.Equals(
                WebViewProfile.ReadChromeTheme(),
                "dark",
                StringComparison.OrdinalIgnoreCase);

            ApplyChromeTheme(false);

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

                Browser.ZoomFactor = 0.90;

                if (!_lifecycle.IsCurrent(generation) ||
                    _disposed)
                {
                    return;
                }

                Browser.NavigationCompleted -=
                    Browser_NavigationCompleted;
                Browser.NavigationCompleted +=
                    Browser_NavigationCompleted;

                Browser.CoreWebView2.Navigate(
                    WebViewProfile.StartupUrl);

                _lifecycle.MarkReady(generation);
                FocusBrowser();
                StartBindingTimer();
            }
            catch (OperationCanceledException)
            {
            }
            catch
            {
                _lifecycle.MarkFailed(
                    generation,
                    "WEBVIEW_INIT_FAILED");
            }
        }

        private async void Browser_NavigationCompleted(
            object? sender,
            CoreWebView2NavigationCompletedEventArgs e)
        {
            if (!e.IsSuccess || _disposed)
            {
                return;
            }

            var current =
                Browser.Source?.AbsoluteUri;

            if (IsChatGptPage(current))
            {
                await EnsurePairWindowAsync(
                    _actionCts.Token);
                await PollBindingStatusAsync(
                    _actionCts.Token);
            }
        }

        private static bool IsChatGptPage(
            string? value)
        {
            if (!Uri.TryCreate(
                value,
                UriKind.Absolute,
                out var uri))
            {
                return false;
            }

            return string.Equals(
                uri.Scheme,
                Uri.UriSchemeHttps,
                StringComparison.OrdinalIgnoreCase) &&
                string.Equals(
                    uri.Host,
                    "chatgpt.com",
                    StringComparison.OrdinalIgnoreCase);
        }

        private void StartBindingTimer()
        {
            if (_bindingTimer != null)
            {
                return;
            }

            _bindingTimer = new DispatcherTimer(
                TimeSpan.FromSeconds(1),
                DispatcherPriority.Background,
                BindingTimer_Tick,
                Dispatcher);
            _bindingTimer.Start();
        }

        private async void BindingTimer_Tick(
            object? sender,
            EventArgs e)
        {
            if (_disposed || _pollInProgress)
            {
                return;
            }

            _pollInProgress = true;
            try
            {
                await PollBindingStatusAsync(
                    _actionCts.Token);
            }
            catch (OperationCanceledException)
            {
            }
            finally
            {
                _pollInProgress = false;
            }
        }

        private async Task EnsurePairWindowAsync(
            CancellationToken token)
        {
            if (_disposed ||
                !string.IsNullOrWhiteSpace(_pairId))
            {
                return;
            }

            try
            {
                var pair =
                    await _control.StartPairAsync(
                        token);
                if (!pair.Ok ||
                    string.IsNullOrWhiteSpace(
                        pair.PairId))
                {
                    return;
                }

                _pairId = pair.PairId;
                if (!DateTime.TryParse(
                    pair.ExpiresAt,
                    out _pairExpiresUtc))
                {
                    _pairExpiresUtc =
                        DateTime.UtcNow.AddMinutes(3);
                }
                else
                {
                    _pairExpiresUtc =
                        _pairExpiresUtc.ToUniversalTime();
                }
            }
            catch (AddinControlException)
            {
                // Read-only header is best effort. ChatGPT itself stays usable.
            }
        }

        private async Task PollBindingStatusAsync(
            CancellationToken token)
        {
            if (_disposed)
            {
                return;
            }

            if (string.IsNullOrWhiteSpace(_pairId))
            {
                await EnsurePairWindowAsync(token);
            }

            if (string.IsNullOrWhiteSpace(_pairId))
            {
                RefreshHeaderFromLocalContext(false);
                return;
            }

            try
            {
                var status =
                    await _control.GetBindingStatusAsync(
                        _pairId!,
                        token);

                if (status.Paired)
                {
                    _control.SavePairId(_pairId!);

                    if (status.SessionReady)
                    {
                        // session_ready=true is authoritative binding evidence.
                        // A temporary session/transport gap must never clear the
                        // last drawing that the add-in knows is bound.
                        _lastConfirmedBoundDrawing =
                            status.Drawing;
                    }

                    RefreshHeaderFromLocalContext(
                        status.SessionReady &&
                        status.HumanPower);
                    return;
                }

                // An invalid/old pair may be renewed, but it is not evidence
                // that the drawing binding itself disappeared.
                if (_pairExpiresUtc == DateTime.MinValue ||
                    DateTime.UtcNow >= _pairExpiresUtc)
                {
                    _pairId = null;
                    _control.ClearSavedPairId();
                    await EnsurePairWindowAsync(token);
                }

                RefreshHeaderFromLocalContext(false);
            }
            catch (AddinControlException)
            {
                // Header has no timeout semantics. Do not infer Human Power
                // OFF from a transport/control-plane failure. The header
                // changes mode only from observed WorkRegistration state
                // returned by add-in control.
                if (_pairExpiresUtc == DateTime.MinValue)
                {
                    _pairId = null;
                    _control.ClearSavedPairId();
                    await EnsurePairWindowAsync(token);
                }
            }
        }

        private void RefreshHeaderFromLocalContext(
            bool humanPower)
        {
            if (humanPower)
            {
                BoundDrawingText.Text =
                    "HUMAN POWER ON";
                BoundDrawingText.ToolTip =
                    "Human Power is active for the current CadGPT task.";
                _boundDrawingClosed = false;
                _bindingMismatch = false;
                ApplyChromeTheme(true);
                return;
            }

            var bound =
                _lastConfirmedBoundDrawing;
            var active =
                ActiveDrawingIdentity();

            var displayName =
                bound?.Name;

            if (string.IsNullOrWhiteSpace(
                displayName) &&
                !string.IsNullOrWhiteSpace(
                    bound?.FullName))
            {
                displayName =
                    Path.GetFileName(
                        bound!.FullName);
            }

            BoundDrawingText.Text =
                string.IsNullOrWhiteSpace(displayName)
                    ? "Not bound"
                    : displayName;

            BoundDrawingText.ToolTip =
                !string.IsNullOrWhiteSpace(
                    bound?.FullName)
                    ? bound!.FullName
                    : BoundDrawingText.Text;

            _boundDrawingClosed =
                bound != null &&
                !BoundDrawingIsOpen(bound);

            _bindingMismatch =
                bound != null &&
                !_boundDrawingClosed &&
                active != null &&
                !DrawingMatches(bound, active);

            ApplyChromeTheme(false);
        }

        private static bool BoundDrawingIsOpen(
            AddinDrawingSummary bound)
        {
            try
            {
                foreach (AcDocument document in
                    AcApplication.DocumentManager)
                {
                    try
                    {
                        if (DrawingMatches(
                            bound,
                            DocumentIdentity(document)))
                        {
                            return true;
                        }
                    }
                    catch
                    {
                        // A document can disappear while AutoCAD is closing it.
                    }
                }

                return false;
            }
            catch
            {
                // Failure to inspect AutoCAD documents is not proof that the
                // drawing closed. Preserve the last confirmed bound state.
                return true;
            }
        }

        private static bool DrawingMatches(
            AddinDrawingSummary bound,
            ActiveDrawingInfo? drawing)
        {
            if (drawing == null)
            {
                return false;
            }

            if (!string.IsNullOrWhiteSpace(
                    bound.FullName) &&
                !string.IsNullOrWhiteSpace(
                    drawing.FullName))
            {
                return string.Equals(
                    bound.FullName,
                    drawing.FullName,
                    StringComparison.OrdinalIgnoreCase);
            }

            return !string.IsNullOrWhiteSpace(
                    bound.Name) &&
                !string.IsNullOrWhiteSpace(
                    drawing.Name) &&
                string.Equals(
                    bound.Name,
                    drawing.Name,
                    StringComparison.OrdinalIgnoreCase);
        }

        private static ActiveDrawingInfo?
            ActiveDrawingIdentity()
        {
            try
            {
                var document =
                    AcApplication.DocumentManager
                        .MdiActiveDocument;
                return document == null
                    ? null
                    : DocumentIdentity(document);
            }
            catch
            {
                return null;
            }
        }

        private static ActiveDrawingInfo
            DocumentIdentity(
                AcDocument document)
        {
            var filename =
                document.Database.Filename;

            return new ActiveDrawingInfo
            {
                Name =
                    string.IsNullOrWhiteSpace(
                        document.Name)
                        ? null
                        : document.Name.Trim(),
                FullName =
                    string.IsNullOrWhiteSpace(
                        filename)
                        ? null
                        : filename.Trim(),
            };
        }

        private async void ThemeButton_Click(
            object sender,
            RoutedEventArgs e)
        {
            _darkChrome = !_darkChrome;
            ApplyBaseChromeTheme();
            WebViewProfile.TrySaveChromeTheme(
                _darkChrome
                    ? "dark"
                    : "light");

            try
            {
                await PollBindingStatusAsync(
                    _actionCts.Token);
            }
            catch (OperationCanceledException)
            {
            }
        }

        private void ApplyChromeTheme(
            bool humanPower)
        {
            ApplyBaseChromeTheme();
            ApplyHeaderTheme(humanPower);
        }

        private void ApplyBaseChromeTheme()
        {
            var rootBackground =
                new SolidColorBrush(
                    _darkChrome
                        ? Color.FromRgb(
                            24, 24, 24)
                        : Color.FromRgb(
                            255, 255, 255));
            var buttonBackground =
                new SolidColorBrush(
                    _darkChrome
                        ? Color.FromRgb(
                            45, 45, 45)
                        : Color.FromRgb(
                            245, 245, 245));
            var buttonForeground =
                new SolidColorBrush(
                    _darkChrome
                        ? Color.FromRgb(
                            245, 245, 245)
                        : Color.FromRgb(
                            30, 30, 30));
            var border =
                new SolidColorBrush(
                    _darkChrome
                        ? Color.FromRgb(
                            65, 65, 65)
                        : Color.FromRgb(
                            220, 220, 220));

            RootGrid.Background = rootBackground;
            ToolbarBorder.BorderBrush = border;

            ThemeButton.Background =
                buttonBackground;
            ThemeButton.Foreground =
                buttonForeground;
            ThemeButton.BorderBrush = border;
            ThemeButton.Content =
                _darkChrome
                    ? "Light"
                    : "Dark";
        }

        private void ApplyHeaderTheme(
            bool humanPower)
        {
            var normalHeader =
                new SolidColorBrush(
                    _darkChrome
                        ? Color.FromRgb(
                            24, 24, 24)
                        : Color.FromRgb(
                            255, 255, 255));
            var headerWarning =
                _boundDrawingClosed ||
                _bindingMismatch;
            var headerBackground =
                humanPower
                    ? new SolidColorBrush(
                        Color.FromRgb(
                            34, 211, 238))
                    : _boundDrawingClosed
                        ? new SolidColorBrush(
                            Color.FromRgb(
                                250, 204, 21))
                        : _bindingMismatch
                            ? new SolidColorBrush(
                                Color.FromRgb(
                                    245, 158, 11))
                            : normalHeader;
            var headerForeground =
                new SolidColorBrush(
                    humanPower ||
                    headerWarning
                        ? Color.FromRgb(
                            20, 20, 20)
                        : _darkChrome
                            ? Color.FromRgb(
                                245, 245, 245)
                            : Color.FromRgb(
                                30, 30, 30));

            ToolbarBorder.Background =
                headerBackground;
            BoundDrawingText.Foreground =
                headerForeground;
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

            if (_bindingTimer != null)
            {
                _bindingTimer.Stop();
                _bindingTimer.Tick -=
                    BindingTimer_Tick;
                _bindingTimer = null;
            }

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
            _lifecycle.CompleteDispose(
                generation);
        }

        private sealed class ActiveDrawingInfo
        {
            public string? Name { get; set; }
            public string? FullName { get; set; }
        }
    }
}
