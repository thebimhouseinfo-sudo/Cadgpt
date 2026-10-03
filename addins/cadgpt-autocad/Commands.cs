using Autodesk.AutoCAD.Runtime;

[assembly: CommandClass(typeof(CadGpt.AutoCad.Commands))]

namespace CadGpt.AutoCad
{
    public sealed class Commands
    {
        [CommandMethod("CADGPT", CommandFlags.Session)]
        public void ShowCadGpt()
        {
            PaletteController.Show();
        }
    }
}
