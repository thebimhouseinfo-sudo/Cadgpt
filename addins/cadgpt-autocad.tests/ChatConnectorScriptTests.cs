using Microsoft.VisualStudio.TestTools.UnitTesting;
using CadGpt.AutoCad.Stage0;

namespace CadGpt.AutoCad.Tests
{
    [TestClass]
    public sealed class ChatConnectorScriptTests
    {
        [TestMethod]
        public void RequiresExactlyOneVisibleCadGptConnectorCandidate()
        {
            var script = ChatConnectorScript.BuildInvokeCadGptScript();

            StringAssert.Contains(script, "suggestions.length !== 1");
            StringAssert.Contains(script, "CG_CONNECTOR_NOT_FOUND");
            StringAssert.Contains(script, "CG_CONNECTOR_AMBIGUOUS");
            StringAssert.Contains(script, "name === 'cg' || name === 'cadgpt'");
        }

        [TestMethod]
        public void SendsOnlyBareCadGptInvocation()
        {
            var script = ChatConnectorScript.BuildInvokeCadGptScript();

            StringAssert.Contains(script, "setter.call(composer, '@cg')");
            Assert.IsFalse(script.Contains("connect drawing"));
            Assert.IsFalse(script.Contains("new chat"));
            Assert.IsFalse(script.Contains("new conversation"));
        }

        [TestMethod]
        public void DoesNotAccessCredentialsStorageOrNetworkApis()
        {
            var script = ChatConnectorScript.BuildInvokeCadGptScript();

            Assert.IsFalse(script.Contains("document.cookie"));
            Assert.IsFalse(script.Contains("localStorage"));
            Assert.IsFalse(script.Contains("sessionStorage"));
            Assert.IsFalse(script.Contains("indexedDB"));
            Assert.IsFalse(script.Contains("fetch("));
            Assert.IsFalse(script.Contains("XMLHttpRequest"));
        }
    }
}
