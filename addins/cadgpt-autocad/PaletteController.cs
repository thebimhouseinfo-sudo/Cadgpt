using System;
using System.Drawing;
using Autodesk.AutoCAD.Windows;

namespace CadGpt.AutoCad
{
    internal static class PaletteController
    {
        private static readonly Guid PaletteId = new Guid("34F319C7-C59A-46A4-83A1-33B1B919BEE6");
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
            DisposeCurrent();
            EnsureCreated();
            if (_palette != null)
            {
                _palette.Visible = true;
            }
        }

        public static void Shutdown()
        {
            DisposeCurrent();
        }

        private static void EnsureCreated()
        {
            if (_palette != null && _view != null)
            {
                return;
            }

            var view = new ChatView();
             var palette = new PaletteSet("CADGPT", PaletteId)
            {
                DockEnabled = DockSides.Left | DockSides.Right,
                MinimumSize = new Size(360, 480),
                Size = new Size(520, 760),
                // AutoCAD can otherwise reclaim input focus from modeless palettes.
                // WebView2 needs the palette to retain focus so native WebAuthn/
                // Windows Security prompts are launched from an active browser host.
                KeepFocus = true
            };

            palette.AddVisual("CADGPT", view, true);
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
