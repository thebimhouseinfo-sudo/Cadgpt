using Microsoft.VisualStudio.TestTools.UnitTesting;
using CadGpt.AutoCad.Stage0;

namespace CadGpt.AutoCad.Tests
{
    [TestClass]
    public sealed class ChatConnectorScriptTests
    {
        [TestMethod]
        public void PairingScriptInvokesBareCadGptOnly()
        {
            var script =
                ChatConnectorScript.InvokeCadGpt();

            StringAssert.Contains(
                script,
                "setter.call(composer, '@cg')");
            StringAssert.Contains(
                script,
                "CG_CONNECTOR_NOT_FOUND");
            StringAssert.Contains(
                script,
                "suggestions.length !== 1");
            Assert.IsFalse(
                script.Contains("connect drawing"));
            Assert.IsFalse(
                script.ToLowerInvariant().Contains("new chat"));
        }

        [TestMethod]
        public void PairingScriptDoesNotReadSecretsOrUseNetworkApis()
        {
            var script =
                ChatConnectorScript.InvokeCadGpt();

            Assert.IsFalse(
                script.Contains("document.cookie"));
            Assert.IsFalse(
                script.Contains("localStorage"));
            Assert.IsFalse(
                script.Contains("sessionStorage"));
            Assert.IsFalse(
                script.Contains("indexedDB"));
            Assert.IsFalse(
                script.Contains("XMLHttpRequest"));
            Assert.IsFalse(
                script.Contains("fetch("));
        }
    }
}
