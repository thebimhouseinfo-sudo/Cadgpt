using Autodesk.AutoCAD.Runtime;

namespace CadGpt.AutoCad
{
    public sealed class Commands
    {
        [CommandMethod("CGSTAGE0", CommandFlags.Session)]
        public void ShowStage0()
        {
            PaletteController.Show();
        }

        [CommandMethod("CGSTAGE0RECREATE", CommandFlags.Session)]
        public void RecreateStage0()
        {
            PaletteController.Recreate();
        }
    }
}
