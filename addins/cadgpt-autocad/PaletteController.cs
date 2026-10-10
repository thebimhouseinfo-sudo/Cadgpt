using System;
using System.Drawing;
using Autodesk.AutoCAD.Windows;

namespace CadGpt.AutoCad
{
    internal static class PaletteController
    {
        private static readonly Guid PaletteId = new Guid("A9C4F4D2-8E2A-4F76-9A1D-5C63E7B2F941");
        private static PaletteSet? _palette;
        private static ChatView? _view;

        public static void Show()
        {
            EnsureCreated();
            if (_palette != null)
            {
                _palette.Visible = true;
            }
        }

        public static void Recreate()
        {
            _view?.PreservePairForRecreate();
            DisposeCurrent();
            EnsureCreated();
            if (_palette != null)
            {
                _palette.Visible = true;
            }
        }

        public static void Shutdown()
        {
            // Only AutoCAD host termination revokes Job authority globally.
            // Recreate()/palette refresh must preserve the existing pair.
            _view?.NotifyCadHostClosed();
            DisposeCurrent();
        }

        private static void EnsureCreated()
        {
            if (_palette != null && _view != null)
            {
                return;
            }

            var view = new ChatView();
            var palette = new PaletteSet("CadGPT", PaletteId)
            {
                DockEnabled = DockSides.Left | DockSides.Right,
                MinimumSize = new Size(360, 480),
                Size = new Size(520, 760),
                // AutoCAD can otherwise reclaim input focus from modeless palettes.
                // WebView2 needs the palette to retain focus so native WebAuthn/
                // Windows Security prompts are launched from an active browser host.
                KeepFocus = true
            };

            palette.AddVisual("CadGPT", view, true);
            _view = view;
            _palette = palette;
        }

        private static void DisposeCurrent()
        {
            var view = _view;
            var palette = _palette;
            _view = null;
            _palette = null;

            if (view != null)
            {
                view.Dispose();
            }

            if (palette != null)
            {
                palette.Visible = false;
                while (palette.Count > 0)
                {
                    palette.Remove(0);
                }

                if (palette is IDisposable disposable)
                {
                    disposable.Dispose();
                }
            }
        }
    }
}
