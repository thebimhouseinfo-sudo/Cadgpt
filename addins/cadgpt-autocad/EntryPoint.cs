using Autodesk.AutoCAD.Runtime;

[assembly: ExtensionApplication(typeof(CadGpt.AutoCad.EntryPoint))]

namespace CadGpt.AutoCad
{
    public sealed class EntryPoint : IExtensionApplication
    {
        public void Initialize()
        {
            // The installed CadGPT.bundle is loaded automatically by AutoCAD.
            // Keep startup silent; the CADGPT command opens/activates the panel.
        }

        public void Terminate()
        {
            PaletteController.Shutdown();
        }
    }
}
