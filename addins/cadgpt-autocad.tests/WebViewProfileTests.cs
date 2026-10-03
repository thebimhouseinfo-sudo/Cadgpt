using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace CadGpt.AutoCad.Tests
{
    [TestClass]
    public sealed class WebViewProfileTests
    {
        [TestMethod]
        public void StartupAlwaysUsesChatGptHome()
        {
            Assert.AreEqual(
                "https://chatgpt.com/",
                WebViewProfile.StartupUrl);
        }
    }
}
