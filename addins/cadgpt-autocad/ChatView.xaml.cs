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
        private bool _pairInProgress;
        private bool _pairWasConfirmed;
        private bool _observedHumanPower;
        private readonly BindingHeaderEvidence _headerEvidence =
            new BindingHeaderEvidence();
        private WeakReference<AcDocument>? _boundDocumentReference;
        private AddinDrawingSummary? _lastConfirmedBoundDrawing;
        private string _lastTickerCaption = string.Empty;
        private bool _lastTickerShouldScroll;
        private bool? _appliedDarkChrome;
        private string? _appliedHeaderTheme;
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

            // Local HTTP + DocumentManager scans do not belong in a 1 Hz
            // UI loop. Three seconds keeps status responsive without adding
            // repeated COM/UI/network work to long CAD operations.
            _bindingTimer = new DispatcherTimer(
                TimeSpan.FromSeconds(3),
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

            if (_disposed)
            {
                return;
            }

            try
            {
                await PollBindingStatusAsync(
                    _actionCts.Token);
            }
            catch (OperationCanceledException)
            {
            }
        }

        private async Task EnsurePairWindowAsync(
            CancellationToken token)
        {
            if (_disposed ||
                _pairInProgress ||
                !string.IsNullOrWhiteSpace(_pairId))
            {
                return;
            }

            _pairInProgress = true;
            try
            {
                var pair = await _control.StartPairAsync(token);
                if (!pair.Ok ||
                    string.IsNullOrWhiteSpace(pair.PairId))
                {
                    return;
                }

                _pairId = pair.PairId;
                _pairWasConfirmed = false;
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
                // Pair setup is best effort; keep the browser usable.
            }
            finally
            {
                _pairInProgress = false;
            }
        }

        private async Task PollBindingStatusAsync(
            CancellationToken token)
        {
            // Navigation, the dispatcher timer, theme changes and wake
            // recovery can all request status. Only one request may be in
            // flight: stale/out-of-order replies can otherwise replace a
            // newer bound drawing and increase response latency.
            if (_disposed || _pollInProgress)
            {
                return;
            }

            _pollInProgress = true;
            try
            {
                if (string.IsNullOrWhiteSpace(_pairId))
                {
                    await EnsurePairWindowAsync(token);
                }

                if (string.IsNullOrWhiteSpace(_pairId))
                {
                    RefreshHeaderFromLocalContext(
                        _observedHumanPower);
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
                        _pairWasConfirmed = true;
                        _control.SavePairId(_pairId!);

                        // session_ready=true means the control-plane
                        // observer is alive, NOT that the current FILE Job
                        // owns the previously bound drawing. A null drawing
                        // cannot revoke an earlier confirmed CAD binding.
                        if (status.SessionReady &&
                            status.Drawing != null)
                        {
                            SetConfirmedBoundDrawing(
                                status.Drawing);
                        }

                        // Only an authoritative session response can
                        // change Human Power mode. Missing/failed pairing
                        // polls must not override the last observed mode.
                        if (status.SessionReady)
                        {
                            _observedHumanPower =
                                status.SessionReady &&
                                status.HumanPower;
                        }

                        RefreshHeaderFromLocalContext(
                            _observedHumanPower);
                        RefreshBackgroundJobs(
                            status.BackgroundJobs);
                        return;
                    }

                    // A newly started pair remains pending until ChatGPT
                    // claims it or its three-minute window expires. Rotating
                    // every poll can invalidate the pair before admission.
                    // A formerly confirmed pair may renew immediately when
                    // the control-plane explicitly reports paired=false.
                    if (AddinPairRenewalPolicy.ShouldRenew(
                            _pairWasConfirmed,
                            status.Pending,
                            _pairExpiresUtc,
                            DateTime.UtcNow))
                    {
                        _pairId = null;
                        _pairWasConfirmed = false;
                        _pairExpiresUtc = DateTime.MinValue;
                        _control.ClearSavedPairId();
                        await EnsurePairWindowAsync(token);
                    }

                    RefreshHeaderFromLocalContext(
                        _observedHumanPower);
                }
                catch (AddinControlException)
                {
                    // Header has no timeout semantics. Do not infer Human
                    // Power OFF or an unbound drawing from network failure.
                    if (_pairExpiresUtc == DateTime.MinValue)
                    {
                        _pairId = null;
                        _pairWasConfirmed = false;
                        _control.ClearSavedPairId();
                        await EnsurePairWindowAsync(token);
                    }
                }
            }
            finally
            {
                _pollInProgress = false;
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

            var caption = string.Join(
                "   •   ",
                labels);
            var shouldScroll = labels.Count > 1;
            if (caption == _lastTickerCaption &&
                shouldScroll == _lastTickerShouldScroll)
            {
                // Do not restart an infinite ticker animation on every
                // successful background status poll.
                return;
            }

            _lastTickerCaption = caption;
            _lastTickerShouldScroll = shouldScroll;

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

            JobTickerText.Text = caption;
            JobTickerBorder.Visibility =
                Visibility.Visible;
            AnimateJobTicker(shouldScroll);
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
                _headerEvidence.Reset();
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
                _headerEvidence.Reset();
                _boundDocumentReference = null;
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

            // Cache the actual managed AutoCAD Document object once it
            // matches the confirmed binding. Save As / path changes may
            // alter names without closing or switching the document.
            ActiveDrawingInfo? matched = null;
            if (_boundDocumentReference != null &&
                _boundDocumentReference.TryGetTarget(
                    out var originalDocument))
            {
                // Once a particular managed document has been confirmed,
                // do not accidentally "rebind" a different open DWG with
                // the same name/path during Save As or tab reordering.
                matched = drawings.FirstOrDefault(
                    item => ReferenceEquals(
                        item.Document,
                        originalDocument));
            }
            else
            {
                matched = drawings.FirstOrDefault(
                    item => DrawingMatches(
                        bound, item, drawings));
            }
            var boundOpen = matched != null;
            if (matched?.Document != null)
            {
                _boundDocumentReference =
                    new WeakReference<AcDocument>(
                        matched.Document);
            }

            bool? boundActive =
                active == null
                    ? (bool?)null
                    : DrawingMatches(bound, active, drawings);
            _headerEvidence.Observe(boundOpen, boundActive);
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
                _headerEvidence.Reset();
                _boundDocumentReference = null;
            }
        }

        private static string BoundDrawingKey(
            AddinDrawingSummary? drawing)
        {
            if (drawing == null)
            {
                return string.Empty;
            }

            return (
                drawing.RuntimeDocumentId ?? string.Empty) + "|" +
                (DrawingIdentityMatcher.NormalizePath(
                    drawing.FullName) ??
                drawing.Name?.Trim() ??
                string.Empty);
        }

        private bool DrawingMatches(
            AddinDrawingSummary bound,
            ActiveDrawingInfo drawing,
            IReadOnlyCollection<ActiveDrawingInfo>
                openDrawings)
        {
            if (_boundDocumentReference != null &&
                _boundDocumentReference.TryGetTarget(
                    out var confirmedDocument))
            {
                return ReferenceEquals(
                    confirmedDocument,
                    drawing.Document);
            }

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
                        identity.Document = document;
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
                    active.Document = activeDocument;
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
            ApplyHeaderTheme(_observedHumanPower);
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
            if (_appliedDarkChrome == _darkChrome)
            {
                return;
            }
            _appliedDarkChrome = _darkChrome;
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
            var headerTheme =
                humanPower ? "human" :
                _headerEvidence.BoundDrawingClosed ? "closed" :
                _headerEvidence.DifferentTabActive ? "other-tab" :
                _darkChrome ? "dark" : "light";
            if (_appliedHeaderTheme == headerTheme)
            {
                return;
            }
            _appliedHeaderTheme = headerTheme;
            var normalHeader =
                new SolidColorBrush(
                    _darkChrome
                        ? Color.FromRgb(
                            24, 24, 24)
                        : Color.FromRgb(
                            255, 255, 255));
            var headerWarning =
                _headerEvidence.BoundDrawingClosed ||
                _headerEvidence.DifferentTabActive;
            var headerBackground =
                humanPower
                    ? new SolidColorBrush(
                        Color.FromRgb(
                            34, 211, 238))
                    : _headerEvidence.BoundDrawingClosed
                        ? new SolidColorBrush(
                            Color.FromRgb(
                                250, 204, 21))
                        : _headerEvidence.DifferentTabActive
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

        // Called only from IExtensionApplication.Terminate, never from
        // palette recreation. Best-effort, bounded notification: shutdown
        // must not hang AutoCAD if the local driver has disappeared.
        internal void NotifyCadHostClosed()
        {
            if (string.IsNullOrWhiteSpace(_pairId))
            {
                return;
            }

            try
            {
                var pairId = _pairId!;
                using (var cts = new CancellationTokenSource(
                    TimeSpan.FromMilliseconds(1500)))
                {
                    var notification = Task.Run(
                        () => _control.NotifyHostClosedAsync(pairId, cts.Token));
                    notification.Wait(TimeSpan.FromMilliseconds(1800));
                }
            }
            catch
            {
                // Job transition has a safe fallback on next explicit Job.
            }
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
            public AcDocument? Document { get; set; }
        }
    }
}
