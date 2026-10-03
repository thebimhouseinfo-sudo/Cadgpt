using Autodesk.AutoCAD.Runtime;

namespace CadGpt.AutoCad
{
    public sealed class EntryPoint : IExtensionApplication
    {
        public void Initialize()
        {
            // Stage 0 intentionally performs no work at assembly load.
            // The palette is created only when CGSTAGE0 is invoked.
        }

        public void Terminate()
        {
            PaletteController.Shutdown();
        }
    }
}
