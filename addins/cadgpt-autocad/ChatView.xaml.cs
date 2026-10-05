using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Animation;
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
        private int _boundMissingPolls;
        private int _bindingMismatchPolls;
        private DateTime _lastBindingTickUtc =
            DateTime.UtcNow;
        private bool _browserRecoveryInProgress;
        private bool _preservePairOnDispose;
        private readonly Dictionary<string, string>
            _activeBackgroundJobs =
                new Dictionary<string, string>(
                    StringComparer.OrdinalIgnoreCase);
        private readonly Dictionary<string, BackgroundDoneState>
            _doneBackgroundJobs =
                new Dictionary<string, BackgroundDoneState>(
                    StringComparer.OrdinalIgnoreCase);

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
                Browser.CoreWebView2.ProcessFailed -=
                    Browser_ProcessFailed;
                Browser.CoreWebView2.ProcessFailed +=
                    Browser_ProcessFailed;

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
            var now = DateTime.UtcNow;
            var suspendedGap =
                now - _lastBindingTickUtc;
            _lastBindingTickUtc = now;

            if (
                !_disposed &&
                suspendedGap >
                    TimeSpan.FromSeconds(15))
            {
                _ = RecoverAfterSuspensionAsync();
            }

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
                        SetConfirmedBoundDrawing(
                            status.Drawing);
                    }

                    RefreshHeaderFromLocalContext(
                        status.SessionReady &&
                        status.HumanPower);
                    RefreshBackgroundJobs(
                        status.BackgroundJobs);
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


        private void RefreshBackgroundJobs(
            IList<AddinBackgroundJobSummary>? jobs)
        {
            var now = DateTime.UtcNow;
            var incoming =
                (jobs ??
                 new List<AddinBackgroundJobSummary>())
                .Where(
                    job =>
                        !string.IsNullOrWhiteSpace(
                            job.JobId))
                .GroupBy(
                    job => job.JobId,
                    StringComparer.OrdinalIgnoreCase)
                .ToDictionary(
                    group => group.Key,
                    group =>
                        string.IsNullOrWhiteSpace(
                            group.First().JobName)
                            ? group.Key
                            : group.First().JobName,
                    StringComparer.OrdinalIgnoreCase);

            foreach (var active in
                _activeBackgroundJobs.ToArray())
            {
                if (incoming.ContainsKey(active.Key))
                {
                    continue;
                }

                _doneBackgroundJobs[active.Key] =
                    new BackgroundDoneState
                    {
                        Name = active.Value,
                        ExpiresUtc =
                            now.AddSeconds(3),
                    };
            }

            _activeBackgroundJobs.Clear();
            foreach (var job in incoming)
            {
                _activeBackgroundJobs[job.Key] =
                    job.Value;
                _doneBackgroundJobs.Remove(job.Key);
            }

            foreach (var done in
                _doneBackgroundJobs.ToArray())
            {
                if (done.Value.ExpiresUtc <= now)
                {
                    _doneBackgroundJobs.Remove(
                        done.Key);
                }
            }

            var labels =
                _activeBackgroundJobs
                    .OrderBy(
                        job => job.Value,
                        StringComparer.OrdinalIgnoreCase)
                    .Select(
                        job =>
                            job.Value +
                            " — Processing")
                    .Concat(
                        _doneBackgroundJobs
                            .OrderBy(
                                job =>
                                    job.Value.Name,
                                StringComparer.OrdinalIgnoreCase)
                            .Select(
                                job =>
                                    job.Value.Name +
                                    " — Done"))
                    .ToList();

            if (labels.Count == 0)
            {
                JobTickerTransform.BeginAnimation(
                    TranslateTransform.XProperty,
                    null);
                JobTickerTransform.X = 0;
                JobTickerText.Text =
                    string.Empty;
                JobTickerBorder.Visibility =
                    Visibility.Collapsed;
                return;
            }

            JobTickerText.Text =
                string.Join(
                    "   •   ",
                    labels);
            JobTickerBorder.Visibility =
                Visibility.Visible;
            AnimateJobTicker(
                labels.Count > 1);
        }

        private void AnimateJobTicker(
            bool shouldScroll)
        {
            JobTickerTransform.BeginAnimation(
                TranslateTransform.XProperty,
                null);
            JobTickerTransform.X = 0;

            if (!shouldScroll)
            {
                return;
            }

            Dispatcher.BeginInvoke(
                new Action(() =>
                {
                    if (
                        _disposed ||
                        JobTickerBorder.Visibility !=
                            Visibility.Visible)
                    {
                        return;
                    }

                    var viewportWidth =
                        JobTickerViewport.ActualWidth;
                    var textWidth =
                        JobTickerText.ActualWidth;
                    if (
                        viewportWidth <= 0 ||
                        textWidth <= 0)
                    {
                        return;
                    }

                    var distance =
                        viewportWidth +
                        textWidth;
                    var seconds =
                        Math.Max(
                            8.0,
                            distance / 35.0);
                    var animation =
                        new DoubleAnimation(
                            viewportWidth,
                            -textWidth,
                            TimeSpan.FromSeconds(
                                seconds))
                        {
                            RepeatBehavior =
                                RepeatBehavior.Forever,
                        };
                    JobTickerTransform.BeginAnimation(
                        TranslateTransform.XProperty,
                        animation);
                }),
                DispatcherPriority.Loaded);
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
                _boundMissingPolls = 0;
                _bindingMismatchPolls = 0;
                ApplyChromeTheme(true);
                return;
            }

            var bound =
                _lastConfirmedBoundDrawing;
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

            if (bound == null)
            {
                _boundDrawingClosed = false;
                _bindingMismatch = false;
                _boundMissingPolls = 0;
                _bindingMismatchPolls = 0;
                ApplyChromeTheme(false);
                return;
            }

            if (!TryDrawingSnapshot(
                    out var drawings,
                    out var active))
            {
                // UNKNOWN local AutoCAD state: keep the last visual state.
                // A transient DocumentManager failure is never proof that the
                // bound drawing closed or that another tab became active.
                ApplyChromeTheme(false);
                return;
            }

            var boundOpen =
                drawings.Any(
                    drawing =>
                        DrawingMatches(
                            bound,
                            drawing,
                            drawings));

            if (!boundOpen)
            {
                _boundMissingPolls += 1;
                _bindingMismatchPolls = 0;
                _bindingMismatch = false;
                if (_boundMissingPolls >= 3)
                {
                    _boundDrawingClosed = true;
                }
                ApplyChromeTheme(false);
                return;
            }

            _boundMissingPolls = 0;
            _boundDrawingClosed = false;

            if (active == null)
            {
                ApplyChromeTheme(false);
                return;
            }

            if (DrawingMatches(
                    bound,
                    active,
                    drawings))
            {
                _bindingMismatchPolls = 0;
                _bindingMismatch = false;
            }
            else
            {
                _bindingMismatchPolls += 1;
                if (_bindingMismatchPolls >= 2)
                {
                    _bindingMismatch = true;
                }
            }

            ApplyChromeTheme(false);
        }

        private void SetConfirmedBoundDrawing(
            AddinDrawingSummary? drawing)
        {
            var previousKey =
                BoundDrawingKey(
                    _lastConfirmedBoundDrawing);
            var nextKey =
                BoundDrawingKey(drawing);

            _lastConfirmedBoundDrawing =
                drawing;

            if (!string.Equals(
                    previousKey,
                    nextKey,
                    StringComparison.OrdinalIgnoreCase))
            {
                _boundDrawingClosed = false;
                _bindingMismatch = false;
                _boundMissingPolls = 0;
                _bindingMismatchPolls = 0;
            }
        }

        private static string BoundDrawingKey(
            AddinDrawingSummary? drawing)
        {
            if (drawing == null)
            {
                return string.Empty;
            }

            return
                DrawingIdentityMatcher.NormalizePath(
                    drawing.FullName) ??
                drawing.Name?.Trim() ??
                string.Empty;
        }

        private static bool DrawingMatches(
            AddinDrawingSummary bound,
            ActiveDrawingInfo drawing,
            IReadOnlyCollection<ActiveDrawingInfo>
                openDrawings)
        {
            return DrawingIdentityMatcher.Matches(
                new DrawingIdentityValue
                {
                    Name = bound.Name,
                    FullName = bound.FullName,
                },
                new DrawingIdentityValue
                {
                    Name = drawing.Name,
                    FullName = drawing.FullName,
                },
                openDrawings
                    .Select(
                        item =>
                            new DrawingIdentityValue
                            {
                                Name = item.Name,
                                FullName =
                                    item.FullName,
                            })
                    .ToList());
        }

        private static bool TryDrawingSnapshot(
            out List<ActiveDrawingInfo> drawings,
            out ActiveDrawingInfo? active)
        {
            drawings =
                new List<ActiveDrawingInfo>();
            active = null;

            try
            {
                var manager =
                    AcApplication.DocumentManager;
                var activeDocument =
                    manager.MdiActiveDocument;
                var partialFailure = false;

                foreach (AcDocument document in manager)
                {
                    try
                    {
                        var identity =
                            DocumentIdentity(
                                document);
                        drawings.Add(identity);
                        if (
                            activeDocument != null &&
                            ReferenceEquals(
                                document,
                                activeDocument))
                        {
                            active = identity;
                        }
                    }
                    catch
                    {
                        partialFailure = true;
                    }
                }

                if (partialFailure)
                {
                    return false;
                }

                if (
                    active == null &&
                    activeDocument != null)
                {
                    active =
                        DocumentIdentity(
                            activeDocument);
                }

                return true;
            }
            catch
            {
                drawings.Clear();
                active = null;
                return false;
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

        private async void Browser_ProcessFailed(
            object? sender,
            CoreWebView2ProcessFailedEventArgs e)
        {
            await SchedulePaletteRecoveryAsync(
                "WEBVIEW_PROCESS_FAILED");
        }

        private async Task RecoverAfterSuspensionAsync()
        {
            if (
                _disposed ||
                _browserRecoveryInProgress)
            {
                return;
            }

            _browserRecoveryInProgress = true;
            try
            {
                await Task.Delay(
                    TimeSpan.FromSeconds(2),
                    _actionCts.Token);

                try
                {
                    await PollBindingStatusAsync(
                        _actionCts.Token);
                }
                catch (
                    AddinControlException)
                {
                }

                if (
                    _disposed ||
                    Browser.CoreWebView2 == null)
                {
                    return;
                }

                Browser.CoreWebView2.Reload();
            }
            catch (OperationCanceledException)
            {
            }
            catch
            {
                _browserRecoveryInProgress =
                    false;
                await SchedulePaletteRecoveryAsync(
                    "WEBVIEW_RESUME_RECOVERY_FAILED");
            }
            finally
            {
                _browserRecoveryInProgress = false;
            }
        }

        private async Task SchedulePaletteRecoveryAsync(
            string reason)
        {
            if (
                _disposed ||
                _browserRecoveryInProgress)
            {
                return;
            }

            _browserRecoveryInProgress = true;
            try
            {
                await Task.Delay(
                    TimeSpan.FromMilliseconds(500),
                    _actionCts.Token);
                if (_disposed)
                {
                    return;
                }

                Dispatcher.BeginInvoke(
                    new Action(
                        () =>
                        {
                            if (!_disposed)
                            {
                                PaletteController.Recreate();
                            }
                        }),
                    DispatcherPriority.Background);
            }
            catch (OperationCanceledException)
            {
            }
            finally
            {
                _browserRecoveryInProgress = false;
            }
        }

        internal void PreservePairForRecreate()
        {
            _preservePairOnDispose = true;
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
            JobTickerBorder.Background =
                rootBackground;
            JobTickerBorder.BorderBrush =
                border;
            JobTickerText.Foreground =
                buttonForeground;

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
            if (Browser.CoreWebView2 != null)
            {
                Browser.CoreWebView2.ProcessFailed -=
                    Browser_ProcessFailed;
            }

            if (_bindingTimer != null)
            {
                _bindingTimer.Stop();
                _bindingTimer.Tick -=
                    BindingTimer_Tick;
                _bindingTimer = null;
            }

            if (
                !_preservePairOnDispose &&
                !string.IsNullOrWhiteSpace(
                    _pairId))
            {
                var pairToRelease = _pairId;
                _control.ClearSavedPairId();
                _ = Task.Run(
                    async () =>
                    {
                        using (var releaseCts =
                            new CancellationTokenSource(
                                TimeSpan.FromSeconds(2)))
                        {
                            try
                            {
                                await _control.ReleasePairAsync(
                                    pairToRelease!,
                                    releaseCts.Token);
                            }
                            catch
                            {
                            }
                        }
                    });
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

        private sealed class BackgroundDoneState
        {
            public string Name { get; set; } =
                string.Empty;
            public DateTime ExpiresUtc { get; set; }
        }

        private sealed class ActiveDrawingInfo
        {
            public string? Name { get; set; }
            public string? FullName { get; set; }
        }
    }
}
